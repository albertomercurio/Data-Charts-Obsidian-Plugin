// Tooltip and table text: the value first and strong, the series name after it,
// a short stroke of the series color as its key. Names come from the data, so
// everything goes in through textContent, never as HTML.

import type { Facet, Point, Prepared } from "../data";
import type { Theme } from "../option";

export interface Formats {
  x: (x: number) => string;
  number: (n: number) => string;
}

export function formats(prepared: Prepared, locale: string): Formats {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  if (prepared.kind === "category") return { x: (x) => prepared.categories[x] ?? String(x), number: (n) => number.format(n) };
  if (prepared.kind === "value") return { x: (x) => number.format(x), number: (n) => number.format(n) };
  const date = new Intl.DateTimeFormat(locale, prepared.datesOnly ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return { x: (x) => date.format(new Date(x)), number: (n) => number.format(n) };
}

type Param = { seriesId?: string; seriesIndex?: number; color?: string; value?: unknown; data?: unknown; axisValue?: number; name?: string };

/** The tooltip of a facet: every series at the x under the pointer. */
export function tooltip(facet: Facet, theme: Theme, format: Formats): (params: unknown) => HTMLElement {
  // The points of each series by x, for the band and its flag.
  const byX = facet.series.map((s) => new Map<number, Point>(s.points.map((p) => [p.x, p])));
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as Param[];
    const root = createDiv({ cls: "data-chart-tooltip" });
    const first = list.find((p) => p.seriesId?.startsWith("s:"));
    const value = (p: Param): [number, number] | null => {
      const raw = p.value ?? (p.data as { value?: unknown })?.value ?? p.data;
      return Array.isArray(raw) && raw.length >= 2 ? [Number(raw[0]), Number(raw[1])] : null;
    };
    const x = first ? (value(first)?.[0] ?? first.axisValue) : undefined;
    if (x !== undefined) root.createDiv({ cls: "data-chart-tooltip-x", text: format.x(Number(x)) });
    for (const p of list) {
      if (!p.seriesId?.startsWith("s:")) continue;
      const i = Number(p.seriesId.slice(2));
      const prepared = facet.series[i];
      const v = value(p);
      if (!prepared || !v) continue;
      const row = root.createDiv({ cls: "data-chart-tooltip-row" });
      const key = row.createSpan({ cls: "data-chart-key" });
      key.style.backgroundColor = prepared.series.color ?? theme.palette[i % theme.palette.length];
      const unit = prepared.series.unit ? ` ${prepared.series.unit}` : "";
      row.createEl("strong", { text: `${format.number(v[1])}${unit}` });
      row.createSpan({ cls: "data-chart-tooltip-name", text: prepared.series.name });
      const point = byX[i].get(v[0]);
      if (point && (point.low !== undefined || point.high !== undefined)) {
        const band = root.createDiv({ cls: "data-chart-tooltip-band" });
        band.setText(`${point.low !== undefined ? format.number(point.low) : "…"}–${point.high !== undefined ? format.number(point.high) : "…"}${unit}`);
        if (point.high !== undefined && point.y > point.high) band.createSpan({ cls: "data-chart-flag", text: " ↑ above range" });
        else if (point.low !== undefined && point.y < point.low) band.createSpan({ cls: "data-chart-flag", text: " ↓ below range" });
      }
    }
    return root;
  };
}
