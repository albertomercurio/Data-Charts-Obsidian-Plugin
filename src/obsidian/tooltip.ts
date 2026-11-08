// Tooltip and table text: the value first and strong, the series name after it,
// a short stroke of the series color as its key. Names come from the data, so
// everything goes in through textContent, never as HTML.

import type { Facet, Point, Prepared } from "../data";
import { duration, type Theme } from "../option";
import type { Bucket, ChartSpec } from "../spec";

export interface Formats {
  x: (x: number) => string;
  number: (n: number) => string;
  /** A week, month or year of totals. */
  span: (span: [number, number], bucket: Bucket) => string;
}

export function formats(prepared: Prepared, locale: string, spec?: ChartSpec): Formats {
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const number = spec?.y.format === "duration" ? duration : (n: number) => plain.format(n);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const span = ([start, end]: [number, number], bucket: Bucket): string => {
    if (bucket === "year") return String(new Date(start).getFullYear());
    if (bucket === "month") return month.format(new Date(start));
    // The last day of the week, not the start of the next one.
    return day.formatRange(new Date(start), new Date(end - 43200000));
  };
  if (prepared.kind === "category") return { x: (x) => prepared.categories[x] ?? String(x), number, span };
  if (prepared.kind === "value") return { x: (x) => plain.format(x), number, span };
  const date = new Intl.DateTimeFormat(locale, prepared.datesOnly ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return { x: (x) => date.format(new Date(x)), number, span };
}

type Param = { seriesId?: string; seriesIndex?: number; color?: string; value?: unknown; data?: unknown; axisValue?: number; name?: string };

/** The tooltip of a facet: every series at the x under the pointer, and the total of stacked ones. */
export function tooltip(facet: Facet, theme: Theme, format: Formats, colors: string[]): (params: unknown) => HTMLElement {
  // The points of each series by x, for the band and its flag, and the span of totals.
  const byX = facet.series.map((s) => new Map<number, Point>(s.points.map((p) => [p.x, p])));
  const stacked = facet.series.some((s) => s.series.stack);
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as Param[];
    const root = createDiv({ cls: "data-chart-tooltip" });
    const first = list.find((p) => p.seriesId?.startsWith("s:"));
    const value = (p: Param): [number, number] | null => {
      const raw = p.value ?? (p.data as { value?: unknown })?.value ?? p.data;
      return Array.isArray(raw) && raw.length >= 2 ? [Number(raw[0]), Number(raw[1])] : null;
    };
    const x = first ? (value(first)?.[0] ?? first.axisValue) : undefined;
    if (x !== undefined && first) {
      const i = Number(first.seriesId!.slice(2));
      const point = byX[i]?.get(Number(x));
      const bucket = facet.series[i]?.series.agg?.bucket;
      root.createDiv({ cls: "data-chart-tooltip-x", text: point?.span && bucket ? format.span(point.span, bucket) : format.x(Number(x)) });
    }
    let total = 0;
    const units = new Set<string>();
    for (const p of list) {
      if (!p.seriesId?.startsWith("s:")) continue;
      const i = Number(p.seriesId.slice(2));
      const prepared = facet.series[i];
      const v = value(p);
      if (!prepared || !v) continue;
      const row = root.createDiv({ cls: "data-chart-tooltip-row" });
      const key = row.createSpan({ cls: "data-chart-key" });
      key.style.backgroundColor = colors[i] ?? theme.palette[i % theme.palette.length];
      const unit = prepared.series.unit ? ` ${prepared.series.unit}` : "";
      row.createEl("strong", { text: `${format.number(v[1])}${unit}` });
      row.createSpan({ cls: "data-chart-tooltip-name", text: prepared.series.name });
      if (prepared.series.stack) {
        total += v[1];
        units.add(unit);
      }
      const point = byX[i].get(v[0]);
      if (point && (point.low !== undefined || point.high !== undefined)) {
        const band = root.createDiv({ cls: "data-chart-tooltip-band" });
        band.setText(`${point.low !== undefined ? format.number(point.low) : "…"}–${point.high !== undefined ? format.number(point.high) : "…"}${unit}`);
        if (point.high !== undefined && point.y > point.high) band.createSpan({ cls: "data-chart-flag", text: " ↑ above range" });
        else if (point.low !== undefined && point.y < point.low) band.createSpan({ cls: "data-chart-flag", text: " ↓ below range" });
      }
    }
    if (stacked && units.size) {
      const row = root.createDiv({ cls: "data-chart-tooltip-row data-chart-tooltip-total" });
      row.createSpan({ cls: "data-chart-key is-empty" });
      row.createEl("strong", { text: `${format.number(total)}${units.size === 1 ? [...units][0] : ""}` });
      row.createSpan({ cls: "data-chart-tooltip-name", text: "Total" });
    }
    return root;
  };
}
