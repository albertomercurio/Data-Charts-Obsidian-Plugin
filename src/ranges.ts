// Range buttons: from a range to the window of the x axis it shows, for any
// kind of axis. Time ranges count back from the latest x; a number counts back
// that many units (value axis) or categories (category axis); a window is fixed.

import { parseTime } from "./data";
import { asNumber } from "./expr";
import { type AxisKind, parseRange, type Range, TIME_RANGES } from "./spec";

/** The ranges a chart offers: the block's, or the usual time ranges on a time axis, or none. */
export function rangesFor(kind: AxisKind, given: Range[] | undefined): Range[] {
  if (given) return given;
  return kind === "time" ? TIME_RANGES.map(parseRange) : [];
}

/** Calendar months back from a time, keeping the day where the month allows it. */
function monthsBack(t: number, months: number): number {
  const d = new Date(t);
  const whole = Math.floor(months);
  const target = new Date(d.getFullYear(), d.getMonth() - whole, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target.getTime() - (months - whole) * 30 * 86400000;
}

/** The window [start, end] of the axis for a range, given the extent of x; null: the whole extent. */
export function windowOf(range: Range, kind: AxisKind, [min, max]: [number, number]): [number, number] | null {
  switch (range.kind) {
    case "all":
      return null;
    case "duration":
      if (kind !== "time") return null;
      return [Math.max(min, range.ms !== undefined ? max - range.ms : monthsBack(max, range.months ?? 0)), max];
    case "ytd":
      return kind === "time" ? [Math.max(min, new Date(new Date(max).getFullYear(), 0, 1).getTime()), max] : null;
    case "last": {
      const n = range.n ?? 0;
      if (kind === "category") return [Math.max(min, max - n + 1), max];
      if (kind === "time") return [Math.max(min, max - n * 86400000), max];
      return [Math.max(min, max - n), max];
    }
    case "window": {
      const bound = (value: number | string | undefined, fallback: number): number => {
        if (value === undefined) return fallback;
        const parsed = kind === "time" ? parseTime(value) : asNumber(value);
        return parsed ?? fallback;
      };
      const [from, to] = [bound(range.from, min), bound(range.to, max)];
      return from <= to ? [from, to] : [to, from];
    }
  }
}

/** Whether a range would show less than the whole extent: buttons that change nothing are left out. */
export function narrows(range: Range, kind: AxisKind, span: [number, number]): boolean {
  if (range.kind === "all") return true;
  const window = windowOf(range, kind, span);
  return window !== null && (window[0] > span[0] || window[1] < span[1]);
}
