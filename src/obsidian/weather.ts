// One `data-weather` block in a note: looks up the place, asks Open-Meteo for the
// days it can forecast and, for later days, the same days of past years, and
// draws a table of them. Answers are kept for an hour in
// memory and, for offline use, in the device's local storage; nothing is written
// to the vault. Redraws every hour and when the note's properties change.

import { MarkdownRenderChild, moment, parseYaml } from "obsidian";
import { allowedRange, archiveUrl, available, type Day, daysBetween, type Forecast, forecastUrl, geocodeUrl, isoDay, parseForecast, parseWeatherSpec, pastYears, pending, type Place, placeFrom, sky, typicalDays, type WeatherSpec } from "../weather";

export interface WeatherHost {
  weather: Set<WeatherBlock>;
  /** The properties of a note, for `this.`. */
  self(path: string): Record<string, unknown>;
  /** The JSON answer of an address, also when its status is an error. */
  getJson(url: string): Promise<unknown>;
}

interface Answer {
  time: number;
  value: unknown;
}

/** The typical weather of the days beyond the forecast, and the years it comes from. */
interface Typical {
  days: Day[];
  units: Forecast["units"];
  years: string;
  /** The day the forecast reaches the first of them. */
  on: string;
}

const HOUR = 3600000;
const MONTH = 30 * 24 * HOUR;
const STORE = "data-charts-weather:";
const memory = new Map<string, Answer>();

function stored(url: string): Answer | undefined {
  try {
    const text = window.localStorage.getItem(STORE + url);
    return text ? (JSON.parse(text) as Answer) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps an answer on the device, and drops those older than a month. */
function store(url: string, answer: Answer): void {
  try {
    const storage = window.localStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key?.startsWith(STORE)) continue;
      const old = JSON.parse(storage.getItem(key) ?? "null") as Answer | null;
      if (!old || Date.now() - old.time > MONTH) storage.removeItem(key);
    }
    storage.setItem(STORE + url, JSON.stringify(answer));
  } catch {
    // No local storage: the answer stays in memory only.
  }
}

/** A fresh answer, or the last one when the service cannot be reached. */
async function ask(host: WeatherHost, url: string, maxAge: number): Promise<Answer & { stale: boolean }> {
  const last = memory.get(url) ?? stored(url);
  if (last && Date.now() - last.time < maxAge) return { ...last, stale: false };
  try {
    const answer = { time: Date.now(), value: await host.getJson(url) };
    if (!(answer.value as { error?: boolean } | null)?.error) {
      memory.set(url, answer);
      store(url, answer);
    }
    return { ...answer, stale: false };
  } catch (err) {
    if (last) return { ...last, stale: true };
    throw err;
  }
}

export class WeatherBlock extends MarkdownRenderChild {
  private timer: number | null = null;

  constructor(private host: WeatherHost, private source: string, containerEl: HTMLElement, readonly sourcePath: string) {
    super(containerEl);
  }

  onload(): void {
    this.host.weather.add(this);
    this.containerEl.addClass("data-chart", "data-weather");
    void this.render();
    this.registerInterval(window.setInterval(() => void this.render(), HOUR));
  }

  onunload(): void {
    this.host.weather.delete(this);
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  /** Whether a change to this file can change the block: its note, when it reads `this.`. */
  uses(path: string): boolean {
    return path === this.sourcePath && /\bthis\./.test(this.source);
  }

  scheduleReload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.render();
    }, 400);
  }

  private async place(spec: WeatherSpec): Promise<Place> {
    if (spec.latitude !== undefined && spec.longitude !== undefined) {
      return { label: spec.place ?? `${spec.latitude}, ${spec.longitude}`, latitude: spec.latitude, longitude: spec.longitude };
    }
    const answer = await ask(this.host, geocodeUrl(spec.place!, spec.country), MONTH);
    return placeFrom(answer.value, spec.place!, spec.country);
  }

  /** Days beyond the forecast: their typical weather, if the archive answers. */
  private async typical(spec: WeatherSpec, place: Place, today: string): Promise<Typical | null> {
    const later = pending(spec, today);
    if (!later) return null;
    const answers = await Promise.all(
      pastYears(later, today).map((span) =>
        ask(this.host, archiveUrl(place, span, spec.units), MONTH)
          .then((a) => ({ year: span.from.slice(0, 4), weather: parseForecast(a.value) }))
          .catch(() => null),
      ),
    );
    const years = answers.filter((a): a is { year: string; weather: Forecast } => a !== null);
    if (!years.length) return null;
    const rainy = spec.units === "imperial" ? 0.04 : 1;
    return {
      days: typicalDays(daysBetween(later.from, later.to), years.map((y) => y.weather), rainy),
      units: years[0].weather.units,
      years: `${years[years.length - 1].year}–${years[0].year}`,
      on: later.on,
    };
  }

  private async render(): Promise<void> {
    try {
      const today = isoDay(new Date());
      const spec = parseWeatherSpec(this.source, parseYaml, this.host.self(this.sourcePath), today);
      const place = await this.place(spec);
      let span = available(spec, today);
      let forecast: Forecast | null = null;
      let answer: (Answer & { stale: boolean }) | null = null;
      if (span) {
        answer = await ask(this.host, forecastUrl(place, span, spec.units), HOUR);
        // The service's today can differ from the device's by a day: ask again within its range.
        const allowed = allowedRange(answer.value);
        if (allowed) {
          const from = span.from > allowed.from ? span.from : allowed.from;
          const to = span.to < allowed.to ? span.to : allowed.to;
          span = from <= to ? { from, to } : null;
          answer = span ? await ask(this.host, forecastUrl(place, span, spec.units), HOUR) : null;
        }
        if (answer) forecast = parseForecast(answer.value);
      }
      this.draw(spec, place, forecast, answer, await this.typical(spec, place, today), today);
    } catch (err) {
      this.containerEl.empty();
      const box = this.containerEl.createDiv({ cls: "data-chart-error" });
      box.createEl("strong", { text: "Weather: " });
      box.appendText(err instanceof Error ? err.message : String(err));
    }
  }

  private draw(spec: WeatherSpec, place: Place, forecast: Forecast | null, answer: (Answer & { stale: boolean }) | null, typical: Typical | null, today: string): void {
    const locale = moment.locale();
    const root = this.containerEl;
    root.empty();
    root.createDiv({ cls: "data-chart-title", text: spec.title ?? place.label });
    const dayLabel = (date: string) => moment(date, "YYYY-MM-DD").locale(locale).format("ddd D MMM");
    const spanLabel = (from: string, to: string) => (from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`);

    const days = [...(forecast?.days ?? []), ...(typical?.days ?? [])];
    const units = forecast?.units ?? typical?.units;
    if (days.length && units) this.table(days, units, today, locale, dayLabel);

    const later = pending(spec, today);
    if (typical) {
      const which = forecast?.days.length ? "Days in grey: typical weather" : "Typical weather";
      root.createDiv({ cls: "data-weather-note", text: `${which}, the average of ${typical.years}; rain is the share of rainy days. The forecast appears from ${dayLabel(typical.on)}.` });
    } else if (later) root.createDiv({ cls: "data-chart-empty", text: `Forecast for ${spanLabel(later.from, later.to)} from ${dayLabel(later.on)}.` });
    else if (!days.length) root.createDiv({ cls: "data-chart-empty", text: `No weather kept for ${spanLabel(spec.from, spec.to)}.` });

    const footer = root.createDiv({ cls: "data-weather-footer" });
    if (answer) {
      const time = moment(answer.time).locale(locale);
      footer.appendText(answer.stale ? `Offline: forecast of ${time.format("ddd D MMM, HH:mm")} · ` : `Updated ${time.format("HH:mm")} · `);
    }
    footer.createEl("a", { text: "Weather data by Open-Meteo.com", href: "https://open-meteo.com/" });
  }

  private table(days: Day[], units: Forecast["units"], today: string, locale: string, dayLabel: (date: string) => string): void {
    const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const tenth = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const percent = new Intl.NumberFormat(locale, { style: "percent" });
    // Whole numbers; -0.3 °C is 0, not "-0".
    const value = (v: number | null) => (v === null ? "–" : whole.format(Math.round(v) || 0));
    const time = (iso: string | null) => (iso ? iso.slice(11, 16) : "");

    const table = this.containerEl.createDiv({ cls: "data-chart-table" }).createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const text of ["Day", "", units.temperature, "Rain", units.wind]) head.createEl("th", { text });
    const body = table.createEl("tbody");
    for (const day of days) {
      const tr = body.createEl("tr", { cls: [day.date === today ? "is-today" : "", day.typical ? "is-typical" : ""].join(" ").trim() });
      const when = tr.createEl("td");
      when.createDiv({ text: dayLabel(day.date) });
      if (day.sunrise && day.sunset) when.createDiv({ cls: "data-weather-sub", text: `${time(day.sunrise)}–${time(day.sunset)}` });
      const { icon, text } = sky(day.code);
      tr.createEl("td", { cls: "data-weather-sky", text: icon, attr: { title: text, "aria-label": text } });
      tr.createEl("td", { cls: "data-chart-number", text: `${value(day.max)} / ${value(day.min)}` });
      const rain = tr.createEl("td", { cls: "data-chart-number" });
      rain.createDiv({ text: day.chance === null ? "–" : percent.format(day.chance / 100) });
      if (day.rain !== null && day.rain > 0) rain.createDiv({ cls: "data-weather-sub", text: `${tenth.format(day.rain)} ${units.rain}` });
      tr.createEl("td", { cls: "data-chart-number", text: value(day.wind) });
    }
  }
}
