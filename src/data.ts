// Data files into rows, rows into the points of each series: filter, x axis,
// facets, aggregation, moving averages and bands. No Obsidian, no chart library.

import { asNumber, type Fields, test } from "./expr";
import type { AxisKind, Bucket, ChartSpec, Series } from "./spec";
import { unitNext } from "./timeaxis";

export type Row = Record<string, unknown>;

/** A point: x on the axis (ms for time, number for value, index for category) and y. */
export interface Point {
  x: number;
  y: number;
  low?: number;
  high?: number;
  /** The row it comes from, for tables and tooltips (not for aggregated points). */
  row?: Row;
  /** A total over a week, month or year: its start and end; x is its middle. */
  span?: [number, number];
}

export interface PreparedSeries {
  series: Series;
  points: Point[];
}

export interface Facet {
  key: string;
  label: string;
  series: PreparedSeries[];
}

export interface Prepared {
  kind: AxisKind;
  /** Category names, for a category axis. */
  categories: string[];
  facets: Facet[];
  /** Rows after the filter, for the table view. */
  rows: Row[];
  /** Whether every x of a time axis falls at midnight: dates without a time. */
  datesOnly: boolean;
}

// ---------------------------------------------------------------- files

/** Rows of a CSV, JSON (an array, or the first array of objects inside an object) or JSON Lines file. */
export function parseData(path: string, text: string): Row[] {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "jsonl" || ext === "ndjson") {
    return text.split("\n").flatMap((line, i) => {
      if (!line.trim()) return [];
      try {
        const value = JSON.parse(line);
        return value && typeof value === "object" && !Array.isArray(value) ? [value as Row] : [];
      } catch {
        throw new Error(`${path}, line ${i + 1}: not valid JSON`);
      }
    });
  }
  if (ext === "json") {
    const value: unknown = JSON.parse(text);
    const rows = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value).find((v) => Array.isArray(v) && v.some((r) => r && typeof r === "object")) : null;
    if (!Array.isArray(rows)) throw new Error(`${path}: no array of objects in the file`);
    return rows.filter((r): r is Row => Boolean(r) && typeof r === "object" && !Array.isArray(r));
  }
  if (ext === "csv" || ext === "tsv") return parseCsv(text, ext === "tsv" ? "\t" : guessDelimiter(text));
  throw new Error(`${path}: only .csv, .tsv, .json and .jsonl files can be read`);
}

function guessDelimiter(text: string): string {
  const header = text.split("\n", 1)[0];
  return [",", ";", "\t"].map((d) => [d, header.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

/** CSV with a header row and quoted fields; numbers become numbers, empty cells are left out. */
export function parseCsv(text: string, delimiter = ","): Row[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((f) => f !== "")) records.push(record);
      [field, record] = ["", []];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f !== "")) records.push(record);
  const [header, ...body] = records;
  if (!header) return [];
  const names = header.map((name) => name.trim());
  return body.map((cells) => {
    const row: Row = {};
    names.forEach((name, i) => {
      const cell = (cells[i] ?? "").trim();
      if (cell === "") return;
      row[name] = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cell) ? Number(cell) : cell;
    });
    return row;
  });
}

/** A path pattern: `*` within a folder, `**` across folders. */
export function globMatcher(pattern: string): (path: string) => boolean {
  if (!pattern.includes("*")) return (path) => path === pattern;
  const source = pattern
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  const regex = new RegExp(`^${source}$`);
  return (path) => regex.test(path);
}

// ---------------------------------------------------------------- the x axis

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A date or date-time in ms: without a zone, in local time (a day is local midnight). */
export function parseTime(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const m = value.trim().match(DATE);
  if (!m) return null;
  if (m[7]) {
    const t = Date.parse(value.trim().replace(" ", "T"));
    return Number.isNaN(t) ? null : t;
  }
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return date.getMonth() === mo - 1 ? date.getTime() : null;
}

/** The kind of axis the values call for: dates, numbers, or names. */
export function axisKind(values: unknown[]): AxisKind {
  const present = values.filter((v) => v !== undefined && v !== null && v !== "");
  if (!present.length) return "value";
  if (present.every((v) => typeof v === "string" && DATE.test(v.trim()))) return "time";
  if (present.every((v) => asNumber(v) !== null)) return "value";
  return "category";
}

// ---------------------------------------------------------------- aggregation

/** Start of the bucket holding a time, in local time; weeks start on Monday. */
export function bucketStart(t: number, bucket: Bucket): number {
  const d = new Date(t);
  if (bucket === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (bucket === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  if (bucket === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), 0, 1).getTime();
}

function combine(values: number[], fn: string): number {
  if (fn === "sum") return values.reduce((a, b) => a + b, 0);
  if (fn === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (fn === "min") return Math.min(...values);
  if (fn === "max") return Math.max(...values);
  if (fn === "count") return values.length;
  return values[values.length - 1];
}

function aggregate(points: Point[], series: Series, kind: AxisKind): Point[] {
  const agg = series.agg;
  if (!agg) return points;
  const key = (p: Point) => (agg.bucket && kind === "time" ? bucketStart(p.x, agg.bucket) : p.x);
  const groups = new Map<number, Point[]>();
  for (const p of points) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, group]) => {
      const point: Point = { x, y: combine(group.map((p) => p.y), agg.fn) };
      // A week, month or year sits in its middle, between the labels of its start and of the next one.
      if (agg.bucket && agg.bucket !== "day" && kind === "time") {
        const end = unitNext(x, agg.bucket);
        point.span = [x, end];
        point.x = x + (end - x) / 2;
      }
      const lows = group.map((p) => p.low).filter((v): v is number => v !== undefined);
      const highs = group.map((p) => p.high).filter((v): v is number => v !== undefined);
      if (lows.length) point.low = combine(lows, "avg");
      if (highs.length) point.high = combine(highs, "avg");
      return point;
    });
}

function rolling(points: Point[], series: Series): Point[] {
  const window = series.rolling;
  if (!window) return points;
  if ("points" in window) {
    return points.slice(window.points - 1).map((p, i) => ({ x: p.x, y: points.slice(i, i + window.points).reduce((s, q) => s + q.y, 0) / window.points }));
  }
  let start = 0;
  let sum = 0;
  return points.map((p, i) => {
    sum += p.y;
    while (points[start].x <= p.x - window.ms) sum -= points[start++].y;
    return { x: p.x, y: sum / (i - start + 1) };
  });
}

// ---------------------------------------------------------------- preparing a chart

/** The rows that pass the filter, with `this` from the note holding the chart. */
export function filterRows(rows: Row[], spec: ChartSpec, self: Fields = {}): Row[] {
  return spec.where ? rows.filter((row) => test(spec.where!, row, self)) : rows;
}

export function prepare(rows: Row[], spec: ChartSpec, self: Fields = {}): Prepared {
  const kept = filterRows(rows, spec, self);
  const kind = spec.xKind ?? axisKind(kept.map((row) => row[spec.x]));
  const categories: string[] = [];
  const index = new Map<string, number>();
  const xOf = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null;
    if (kind === "time") return parseTime(value);
    if (kind === "value") return asNumber(value);
    const name = String(value);
    if (!index.has(name)) {
      index.set(name, categories.length);
      categories.push(name);
    }
    return index.get(name)!;
  };

  // Facets: one chart for each value, in the order given or of appearance.
  const facetKeys: string[] = [];
  const byFacet = new Map<string, Row[]>();
  for (const row of kept) {
    const key = spec.facet ? String(row[spec.facet] ?? "") : "";
    if (spec.facet && (key === "" || (spec.facets && !spec.facets.includes(key)))) continue;
    if (!byFacet.has(key)) {
      byFacet.set(key, []);
      facetKeys.push(key);
    }
    byFacet.get(key)!.push(row);
  }
  if (spec.facets) facetKeys.sort((a, b) => spec.facets!.indexOf(a) - spec.facets!.indexOf(b));
  if (!facetKeys.length) facetKeys.push("");

  let datesOnly = kind === "time";
  const facets = facetKeys.map((key): Facet => {
    const facetRows = byFacet.get(key) ?? [];
    const series = spec.series.map((s): PreparedSeries => {
      let points: Point[] = [];
      for (const row of facetRows) {
        const x = xOf(row[spec.x]);
        const y = asNumber(s.value(row, self));
        if (x === null || y === null || !Number.isFinite(y)) continue;
        const point: Point = { x, y, row };
        if (s.band) {
          const [low, high] = [asNumber(s.band[0](row, self)), asNumber(s.band[1](row, self))];
          if (low !== null) point.low = low;
          if (high !== null) point.high = high;
        }
        points.push(point);
      }
      points.sort((a, b) => a.x - b.x);
      points = rolling(aggregate(points, s, kind), s);
      if (kind === "time" && datesOnly) datesOnly = points.every((p) => new Date(p.span?.[0] ?? p.x).getHours() === 0 && new Date(p.span?.[0] ?? p.x).getMinutes() === 0);
      return { series: s, points };
    });
    return { key, label: spec.labels[key] ?? key, series };
  });
  return { kind, categories, facets, rows: kept, datesOnly };
}

/** The extent of x over every series of every facet. */
export function extent(prepared: Prepared): [number, number] | null {
  const xs = prepared.facets.flatMap((f) => f.series.flatMap((s) => s.points.map((p) => p.x)));
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** Rows for a table: sorted and limited as the block says. */
export function tableRows(rows: Row[], spec: ChartSpec): Row[] {
  const sorted = [...rows];
  if (spec.sort) {
    const { field, desc } = spec.sort;
    sorted.sort((a, b) => {
      const [x, y] = [a[field], b[field]];
      const [nx, ny] = [asNumber(x), asNumber(y)];
      const order = nx !== null && ny !== null ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""));
      return desc ? -order : order;
    });
  }
  return spec.limit ? sorted.slice(0, spec.limit) : sorted;
}
