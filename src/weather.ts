// The `data-weather` block: the forecast for a place and a span of days, from
// Open-Meteo (https://open-meteo.com, free, no key), and for days beyond the
// forecast their typical weather, from the same days of past years. Here the
// block, the days the service can give, its addresses and its answers, without
// Obsidian.

export interface WeatherSpec {
  title?: string;
  /** A place to look up by name; with coordinates, only their name. */
  place?: string;
  /** ISO 3166-1 alpha-2 code that narrows the lookup. */
  country?: string;
  latitude?: number;
  longitude?: number;
  /** First and last day, YYYY-MM-DD. */
  from: string;
  to: string;
  units: "metric" | "imperial";
}

export interface Place {
  /** Name, region and country, to show. */
  label: string;
  latitude: number;
  longitude: number;
}

export interface Day {
  date: string;
  code: number | null;
  max: number | null;
  min: number | null;
  /** Highest chance of precipitation in the day, in %. */
  chance: number | null;
  rain: number | null;
  wind: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** An average of past years, not a forecast; `chance` is then the share of rainy days. */
  typical?: boolean;
}

export interface Forecast {
  days: Day[];
  units: { temperature: string; rain: string; wind: string };
}

/** Open-Meteo forecasts reach 15 days after today, and keep 92 days before it. */
export const AHEAD = 15;
export const BACK = 92;
/** Past years averaged for the typical weather of a day. */
export const YEARS = 10;
/** The archive of past weather lags by a few days. */
const ARCHIVE_LAG = 6;

const KEYS = ["title", "place", "country", "latitude", "longitude", "from", "to", "days", "units"];
const DAY_MS = 86400000;

/** A local date as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The same day n years later (or earlier); 29 February becomes the 28th. */
export function addYears(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Every day from one day to another. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** `this.Date` or `` this.`End Date` ``: a property of the note; anything else as written. */
function resolve(value: unknown, self: Record<string, unknown>): unknown {
  if (typeof value !== "string" || !value.startsWith("this.")) return value;
  return self[value.slice(5).replace(/`/g, "").trim()];
}

/** The name of a place from text or a link (`[[Notes/Edinburgh|Edimburgo]]` → Edinburgh); the first of a list. */
export function placeName(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null || first === "") return undefined;
  const text = String(first).trim();
  const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(text);
  return link ? link[1].split("/").pop()!.trim() : text;
}

function day(value: unknown, key: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  if (!match) throw new Error(`${key}: a day like 2026-12-04, or this.<property>; not "${String(value)}"`);
  return match[1];
}

function number(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key}: a number, not "${String(value)}"`);
  return n;
}

/** Reads a block. Without `from` the forecast starts today; without `to` it lasts `days` days, 7 by default. */
export function parseWeatherSpec(source: string, parse: (text: string) => unknown, self: Record<string, unknown> = {}, today = isoDay(new Date())): WeatherSpec {
  const raw = parse(source) ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`the block is YAML with the keys ${KEYS.join(", ")}`);
  const block = raw as Record<string, unknown>;
  for (const key of Object.keys(block)) if (!KEYS.includes(key)) throw new Error(`${key}: unknown key; the keys are ${KEYS.join(", ")}`);
  const value = (key: string) => resolve(block[key], self);

  const latitude = number(value("latitude"), "latitude");
  const longitude = number(value("longitude"), "longitude");
  const place = placeName(value("place"));
  if ((latitude === undefined) !== (longitude === undefined)) throw new Error("latitude and longitude: both, or neither");
  if (latitude === undefined && !place) throw new Error(block.place === undefined ? "place: a city, or latitude and longitude" : `place: ${String(block.place)} is empty`);

  const from = day(value("from"), "from") ?? today;
  const days = number(value("days"), "days");
  if (days !== undefined && (!Number.isInteger(days) || days < 1)) throw new Error(`days: a whole number of days, at least 1, not ${days}`);
  if (days !== undefined && block.to !== undefined) throw new Error("days or to, not both");
  const to = day(value("to"), "to") ?? addDays(from, (days ?? 7) - 1);
  if (to < from) throw new Error(`to: ${to} comes before from: ${from}`);

  const units = value("units") ?? "metric";
  if (units !== "metric" && units !== "imperial") throw new Error(`units: metric or imperial, not "${String(units)}"`);
  const country = value("country");
  const title = value("title");
  return {
    ...(title ? { title: String(title) } : {}),
    ...(place ? { place } : {}),
    ...(country ? { country: String(country).toUpperCase() } : {}),
    ...(latitude !== undefined ? { latitude, longitude } : {}),
    from,
    to,
    units,
  };
}

/** The days of the block the service can give today, if any. */
export function available(spec: WeatherSpec, today: string): { from: string; to: string } | null {
  const lo = [spec.from, addDays(today, -BACK)].sort()[1];
  const hi = [spec.to, addDays(today, AHEAD)].sort()[0];
  return lo <= hi ? { from: lo, to: hi } : null;
}

/** Days too far ahead for a forecast, and the day it reaches their first one. */
export function pending(spec: WeatherSpec, today: string): { from: string; to: string; on: string } | null {
  const last = addDays(today, AHEAD);
  if (spec.to <= last) return null;
  const from = spec.from > last ? spec.from : addDays(last, 1);
  return { from, to: spec.to, on: addDays(from, -AHEAD) };
}

export function geocodeUrl(name: string, country?: string): string {
  const query = new URLSearchParams({ name, count: "1", language: "en", format: "json" });
  if (country) query.set("countryCode", country);
  return `https://geocoding-api.open-meteo.com/v1/search?${query}`;
}

export function placeFrom(answer: unknown, name: string, country?: string): Place {
  const result = (answer as { results?: Record<string, unknown>[] } | null)?.results?.[0];
  if (!result) throw new Error(`no place named "${name}"${country ? ` in ${country}` : ""}`);
  const parts = [result.name, result.admin1, result.country].filter((p): p is string => typeof p === "string" && p !== "");
  return { label: [...new Set(parts)].join(", "), latitude: Number(result.latitude), longitude: Number(result.longitude) };
}

const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset";

function dailyUrl(base: string, daily: string, place: { latitude: number; longitude: number }, span: { from: string; to: string }, units: WeatherSpec["units"]): string {
  const query = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    daily,
    timezone: "auto",
    start_date: span.from,
    end_date: span.to,
  });
  if (units === "imperial") {
    query.set("temperature_unit", "fahrenheit");
    query.set("wind_speed_unit", "mph");
    query.set("precipitation_unit", "inch");
  }
  return `${base}?${query}`;
}

export function forecastUrl(place: { latitude: number; longitude: number }, span: { from: string; to: string }, units: WeatherSpec["units"]): string {
  return dailyUrl("https://api.open-meteo.com/v1/forecast", `${DAILY},precipitation_probability_max`, place, span, units);
}

/** The weather that was, from the archive (no chance of rain there). */
export function archiveUrl(place: { latitude: number; longitude: number }, span: { from: string; to: string }, units: WeatherSpec["units"]): string {
  return dailyUrl("https://archive-api.open-meteo.com/v1/archive", DAILY, place, span, units);
}

/** The same days in each of the last YEARS years already in the archive, the latest first. */
export function pastYears(span: { from: string; to: string }, today: string): { from: string; to: string }[] {
  const spans: { from: string; to: string }[] = [];
  const archived = addDays(today, -ARCHIVE_LAG);
  for (let n = 1; spans.length < YEARS && n <= YEARS + 1; n++) {
    const year = { from: addYears(span.from, -n), to: addYears(span.to, -n) };
    if (year.to <= archived) spans.push(year);
  }
  return spans;
}

/**
 * The typical weather of each day, from the same day of past years (latest first):
 * mean highest, lowest, rain and wind; `chance` is the share of years with a rainy
 * day (at least `rainy` of rain); sunrise and sunset of the latest year.
 */
export function typicalDays(days: string[], years: Forecast[], rainy: number): Day[] {
  const mean = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  };
  return days.map((date) => {
    const monthDay = date.endsWith("-02-29") ? "02-28" : date.slice(5);
    const same = years.flatMap((year) => year.days.filter((d) => d.date.slice(5) === monthDay));
    const rains = same.map((d) => d.rain).filter((v): v is number => v !== null);
    return {
      date,
      code: null,
      max: mean(same.map((d) => d.max)),
      min: mean(same.map((d) => d.min)),
      chance: rains.length ? (100 * rains.filter((r) => r >= rainy).length) / rains.length : null,
      rain: mean(same.map((d) => d.rain)),
      wind: mean(same.map((d) => d.wind)),
      sunrise: same[0]?.sunrise ?? null,
      sunset: same[0]?.sunset ?? null,
      typical: true,
    };
  });
}

/** The days the service accepts, when it refuses others (its "today" may differ from the device's). */
export function allowedRange(answer: unknown): { from: string; to: string } | null {
  const reason = (answer as { error?: boolean; reason?: string } | null)?.error ? (answer as { reason?: string }).reason ?? "" : "";
  const match = /allowed range from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(reason);
  return match ? { from: match[1], to: match[2] } : null;
}

export function parseForecast(answer: unknown): Forecast {
  const body = answer as { error?: boolean; reason?: string; daily?: Record<string, unknown[]>; daily_units?: Record<string, string> } | null;
  if (!body || body.error) throw new Error(body?.reason ?? "no answer from Open-Meteo");
  const daily = body.daily ?? {};
  const column = (key: string) => (daily[key] ?? []) as (number | string | null)[];
  const num = (v: number | string | null | undefined) => (typeof v === "number" ? v : null);
  const str = (v: number | string | null | undefined) => (typeof v === "string" ? v : null);
  const days = (column("time") as string[]).map((date, i) => ({
    date,
    code: num(column("weather_code")[i]),
    max: num(column("temperature_2m_max")[i]),
    min: num(column("temperature_2m_min")[i]),
    chance: num(column("precipitation_probability_max")[i]),
    rain: num(column("precipitation_sum")[i]),
    wind: num(column("wind_speed_10m_max")[i]),
    sunrise: str(column("sunrise")[i]),
    sunset: str(column("sunset")[i]),
  }));
  const units = body.daily_units ?? {};
  // Open-Meteo writes miles per hour as "mp/h".
  const wind = (units.wind_speed_10m_max ?? "km/h").replace("mp/h", "mph");
  return { days, units: { temperature: units.temperature_2m_max ?? "°C", rain: units.precipitation_sum ?? "mm", wind } };
}

/** A symbol and a few words for a WMO weather code. */
export function sky(code: number | null): { icon: string; text: string } {
  if (code === null) return { icon: "", text: "" };
  if (code === 0) return { icon: "☀️", text: "Clear sky" };
  if (code === 1) return { icon: "🌤️", text: "Mainly clear" };
  if (code === 2) return { icon: "⛅", text: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", text: "Overcast" };
  if (code === 45 || code === 48) return { icon: "🌫️", text: "Fog" };
  if (code >= 51 && code <= 55) return { icon: "🌦️", text: "Drizzle" };
  if (code === 56 || code === 57) return { icon: "🌧️", text: "Freezing drizzle" };
  if (code >= 61 && code <= 65) return { icon: "🌧️", text: "Rain" };
  if (code === 66 || code === 67) return { icon: "🌧️", text: "Freezing rain" };
  if (code >= 71 && code <= 77) return { icon: "🌨️", text: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "🌦️", text: "Rain showers" };
  if (code === 85 || code === 86) return { icon: "🌨️", text: "Snow showers" };
  if (code === 95) return { icon: "⛈️", text: "Thunderstorm" };
  if (code === 96 || code === 99) return { icon: "⛈️", text: "Thunderstorm with hail" };
  return { icon: "", text: `Code ${code}` };
}
