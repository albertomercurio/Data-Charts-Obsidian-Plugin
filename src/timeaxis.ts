// Labels of a time axis, chosen for the window shown and the width of the chart:
// days, weeks (Mondays), half months, months, quarters or years — the finest
// that leaves room for every label. A label names its month when it is the
// first of that month (or the first one shown), so a change of month is never
// lost; hairlines mark where months (or years) begin. Bars of weekly or monthly
// totals get their label under the bar.

import type { Bucket } from "./spec";

export type TimeUnit = "day" | "week" | "half" | "month" | "quarter" | "year";

export interface TimeAxis {
  unit: TimeUnit;
  /** Where the labels go (ms): the start of each unit, or its middle under bars of totals. */
  labels: number[];
  /** Labels that name their month (or year): the first of each. */
  named: Set<number>;
  /** Hairlines: the starts of months, or of years. */
  lines: number[];
  centered: boolean;
}

const DAY = 86400000;
const UNITS: [TimeUnit, number][] = [["day", 1], ["week", 7], ["half", 15.22], ["month", 30.44], ["quarter", 91.31], ["year", 365.25]];
/** Pixels from one label to the next. */
export const LABEL_GAP = 40;
const MAX_LABELS = 20000;

/** The finest unit whose labels fit; null for less than two days (hours: the chart library's own labels). */
export function timeUnit(spanMs: number, widthPx: number, bucket: Bucket | null = null): TimeUnit | null {
  if (spanMs < 2 * DAY) return null;
  const pxPerDay = widthPx / (spanMs / DAY);
  const first = bucket === "week" ? 1 : bucket === "month" ? 3 : bucket === "year" ? 5 : 0;
  for (let i = first; i < UNITS.length; i++) if (UNITS[i][1] * pxPerDay >= LABEL_GAP) return UNITS[i][0];
  return "year";
}

/** Start of the unit holding a time, in local time; weeks start on Monday. */
export function unitStart(t: number, unit: TimeUnit): number {
  const d = new Date(t);
  const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
  switch (unit) {
    case "day":
      return new Date(y, m, day).getTime();
    case "week":
      return new Date(y, m, day - ((d.getDay() + 6) % 7)).getTime();
    case "half":
      return new Date(y, m, day >= 16 ? 16 : 1).getTime();
    case "month":
      return new Date(y, m, 1).getTime();
    case "quarter":
      return new Date(y, m - (m % 3), 1).getTime();
    case "year":
      return new Date(y, 0, 1).getTime();
  }
}

/** Start of the next unit. */
export function unitNext(t: number, unit: TimeUnit): number {
  const d = new Date(unitStart(t, unit));
  const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
  switch (unit) {
    case "day":
      return new Date(y, m, day + 1).getTime();
    case "week":
      return new Date(y, m, day + 7).getTime();
    case "half":
      return day === 1 ? new Date(y, m, 16).getTime() : new Date(y, m + 1, 1).getTime();
    case "month":
      return new Date(y, m + 1, 1).getTime();
    case "quarter":
      return new Date(y, m + 3, 1).getTime();
    case "year":
      return new Date(y + 1, 0, 1).getTime();
  }
}

const fine = (unit: TimeUnit) => unit === "day" || unit === "week" || unit === "half";

/** Labels and hairlines over [min, max], one per unit; centered: in the middle of each unit (bars of totals). */
export function timeAxis([min, max]: [number, number], unit: TimeUnit, centered = false): TimeAxis {
  const starts: number[] = [];
  for (let t = unitStart(min, unit); t <= max && starts.length < MAX_LABELS; t = unitNext(t, unit)) starts.push(t);
  const labels = centered ? starts.map((t) => t + (unitNext(t, unit) - t) / 2) : starts;
  const named = new Set<number>();
  let previous = "";
  starts.forEach((t, i) => {
    const d = new Date(t);
    const key = fine(unit) ? `${d.getFullYear()}-${d.getMonth()}` : unit === "year" ? `${i}` : `${d.getFullYear()}`;
    if (key !== previous && unit !== "year") named.add(labels[i]);
    previous = key;
  });
  // Hairlines where months begin (or years, when labels are months); not across bars.
  const lines: number[] = [];
  if (!centered && unit !== "year") {
    const step: TimeUnit = fine(unit) ? "month" : "year";
    for (let t = unitNext(min, step); t <= max && lines.length < MAX_LABELS; t = unitNext(t, step)) lines.push(t);
  }
  return { unit, labels, named, lines, centered };
}

/** The text of a label: the day, or the month; with the month (and year) when it is named. */
export function timeLabel(t: number, unit: TimeUnit, named: boolean, locale: string): string {
  const d = new Date(unitStart(t, unit === "half" ? "day" : unit));
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(d);
  if (unit === "year") return String(d.getFullYear());
  if (fine(unit)) {
    if (!named) return String(d.getDate());
    return format(d.getMonth() === 0 ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
  }
  return format(named ? { month: "short", year: "numeric" } : { month: "short" });
}
