// The YAML of a `data-chart` block, read into a checked specification.
// Errors name the key and say what is expected, for the box shown in the note.

import { type Compiled, compile } from "./expr";

export type MarkType = "line" | "area" | "bar" | "scatter";
export type ChartType = MarkType | "table";
export type AxisKind = "time" | "value" | "category";
export type Bucket = "day" | "week" | "month" | "year";
export type AggFn = "sum" | "avg" | "min" | "max" | "last" | "count";

export interface Range {
  label: string;
  /** duration: the last `months`/`ms` up to the latest x; ytd; all; last: the last `n` units or categories; window: from–to. */
  kind: "duration" | "ytd" | "all" | "last" | "window";
  ms?: number;
  months?: number;
  n?: number;
  from?: number | string;
  to?: number | string;
}

export interface Series {
  /** The expression, as written. */
  y: string;
  value: Compiled;
  name: string;
  type: MarkType;
  color?: string;
  /** Moving average: a number of points, or a time window ("7d", "4w"). */
  rolling?: { points: number } | { ms: number };
  /** Aggregation: by time bucket (time axis) or by equal x, with a function. */
  agg?: { bucket: Bucket | null; fn: AggFn };
  band?: [Compiled, Compiled];
  goal?: number;
  points?: boolean;
  smooth?: boolean;
  unit?: string;
}

export interface ChartSpec {
  sources: string[];
  x: string;
  xKind?: AxisKind;
  type: ChartType;
  title?: string;
  height: number;
  where?: Compiled;
  facet?: string;
  facets?: string[];
  labels: Record<string, string>;
  range?: string;
  ranges?: Range[];
  series: Series[];
  group?: string;
  y: { min?: number; max?: number; zero?: boolean; log?: boolean; unit?: string };
  columns?: string[];
  sort?: { field: string; desc: boolean };
  limit?: number;
}

const MARKS: MarkType[] = ["line", "area", "bar", "scatter"];
const BUCKETS: Bucket[] = ["day", "week", "month", "year"];
const FNS: AggFn[] = ["sum", "avg", "min", "max", "last", "count"];
const KEYS = new Set([
  "source", "x", "type", "title", "height", "where", "facet", "facets", "labels", "range", "ranges", "series", "y",
  "name", "color", "rolling", "agg", "band", "goal", "points", "smooth", "unit", "group", "yaxis", "columns", "sort", "limit",
]);
const SERIES_KEYS = new Set(["y", "name", "type", "color", "rolling", "agg", "band", "goal", "points", "smooth", "unit"]);

const DAY = 86400000;
const UNITS: Record<string, { ms?: number; months?: number }> = { h: { ms: 3600000 }, d: { ms: DAY }, w: { ms: 7 * DAY }, m: { months: 1 }, y: { months: 12 } };

/** Time ranges for a time axis when the block gives none. */
export const TIME_RANGES = ["1W", "1M", "3M", "6M", "1Y", "3Y", "All"];

const fail = (key: string, message: string): never => {
  throw new Error(`${key}: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined);

/** "1W", "3M", "1Y", "12h", "YTD", "All"; a number: the last N; {label: [from, to]}: a window. */
export function parseRange(value: unknown): Range {
  if (typeof value === "number" && value > 0) return { label: String(value), kind: "last", n: value };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^all$/i.test(trimmed)) return { label: "All", kind: "all" };
    if (/^ytd$/i.test(trimmed)) return { label: "YTD", kind: "ytd" };
    const duration = trimmed.match(/^(\d+(?:\.\d+)?)\s*([hdwmy])$/i);
    if (duration) {
      const unit = UNITS[duration[2].toLowerCase()];
      const n = Number(duration[1]);
      return { label: trimmed.toUpperCase(), kind: "duration", ...(unit.ms ? { ms: unit.ms * n } : { months: unit.months! * n }) };
    }
    const last = trimmed.match(/^last\s+(\d+(?:\.\d+)?)$/i);
    if (last) return { label: trimmed, kind: "last", n: Number(last[1]) };
  }
  if (isRecord(value) && Object.keys(value).length === 1) {
    const [label, bounds] = Object.entries(value)[0];
    if (Array.isArray(bounds) && bounds.length === 2 && bounds.every((b) => typeof b === "number" || typeof b === "string")) {
      return { label, kind: "window", from: bounds[0] as number | string, to: bounds[1] as number | string };
    }
  }
  return fail("ranges", `"${JSON.stringify(value)}" is not a range: use 1W, 3M, 1Y, YTD, All, a number (the last N), or {label: [from, to]}`);
}

function parseAgg(value: unknown): Series["agg"] {
  if (value === undefined) return undefined;
  const parts = String(value).split("/").map((part) => part.trim().toLowerCase());
  const [bucket, fn] = parts.length === 2 ? parts : [null, parts[0]];
  if (bucket !== null && !BUCKETS.includes(bucket as Bucket)) fail("agg", `"${bucket}" is not one of ${BUCKETS.join(", ")}`);
  if (!FNS.includes(fn as AggFn)) fail("agg", `"${fn}" is not one of ${FNS.join(", ")}`);
  return { bucket: bucket as Bucket | null, fn: fn as AggFn };
}

function parseRolling(value: unknown): Series["rolling"] {
  if (value === undefined) return undefined;
  if (typeof value === "number" && value >= 1) return { points: Math.round(value) };
  const m = typeof value === "string" ? value.trim().match(/^(\d+(?:\.\d+)?)\s*([hdw])$/i) : null;
  if (m) return { ms: Number(m[1]) * UNITS[m[2].toLowerCase()].ms! };
  return fail("rolling", `"${value}" is not a number of points or a time window like 7d`);
}

function parseSeries(raw: unknown, defaults: Record<string, unknown>, chartType: ChartType): Series {
  const item = isRecord(raw) ? raw : { y: raw };
  for (const key of Object.keys(item)) if (!SERIES_KEYS.has(key)) fail("series", `unknown key "${key}"`);
  const merged = { ...defaults, ...item };
  const y = text(merged.y);
  if (!y) return fail("series", "each series needs y: a field or an expression");
  const type = (item.type ?? (chartType === "table" ? "line" : chartType)) as MarkType;
  if (!MARKS.includes(type)) fail("type", `"${type}" is not one of ${MARKS.join(", ")}`);
  const series: Series = { y, value: compile(y), name: text(merged.name) ?? y, type };
  if (typeof merged.color === "string") series.color = merged.color;
  series.rolling = parseRolling(merged.rolling);
  series.agg = parseAgg(merged.agg);
  if (merged.band !== undefined) {
    if (!Array.isArray(merged.band) || merged.band.length !== 2) fail("band", "two fields or expressions: [low, high]");
    series.band = [compile(String((merged.band as unknown[])[0])), compile(String((merged.band as unknown[])[1]))];
  }
  if (merged.goal !== undefined) {
    if (typeof merged.goal !== "number") fail("goal", "a number");
    series.goal = merged.goal as number;
  }
  if (merged.points !== undefined) series.points = merged.points === true;
  if (merged.smooth !== undefined) series.smooth = merged.smooth === true;
  if (merged.unit !== undefined) series.unit = String(merged.unit);
  return series;
}

/** The specification of a block; `parseYaml` is Obsidian's (or the yaml package's, in tests). */
export function parseSpec(source: string, parseYaml: (text: string) => unknown): ChartSpec {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new Error(`invalid YAML: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  if (!isRecord(raw)) throw new Error("the block needs YAML keys, at least source and y (see the plugin's README)");
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) fail(key, "unknown key");

  const sources = (Array.isArray(raw.source) ? raw.source : [raw.source]).map(text).filter((s): s is string => Boolean(s && s.trim()));
  if (!sources.length) fail("source", "the file to read: a path in the vault, a list of paths or a pattern with *");

  const type = (raw.type ?? "line") as ChartType;
  if (![...MARKS, "table"].includes(type)) fail("type", `"${type}" is not one of ${[...MARKS, "table"].join(", ")}`);

  let x = "";
  let xKind: AxisKind | undefined;
  if (isRecord(raw.x)) {
    x = text(raw.x.field) ?? "";
    if (raw.x.type !== undefined) {
      if (!["time", "value", "category"].includes(String(raw.x.type))) fail("x", "type is time, value or category");
      xKind = raw.x.type as AxisKind;
    }
  } else x = text(raw.x) ?? "";
  if (!x && type !== "table") fail("x", "the field of the horizontal axis");

  const defaults: Record<string, unknown> = {};
  for (const key of SERIES_KEYS) if (key !== "y" && raw[key] !== undefined) defaults[key] = raw[key];
  const list = raw.series !== undefined ? (Array.isArray(raw.series) ? raw.series : [raw.series]) : raw.y !== undefined ? [{ y: raw.y }] : [];
  if (!list.length && type !== "table") fail("y", "the field (or expression) to plot, or a list of series");
  const series = list.map((item) => parseSeries(item, defaults, type));

  const spec: ChartSpec = { sources, x, type, height: 300, labels: {}, series, y: {} };
  if (xKind) spec.xKind = xKind;
  if (raw.title !== undefined) spec.title = String(raw.title);
  if (raw.height !== undefined) {
    if (typeof raw.height !== "number" || raw.height < 120 || raw.height > 2000) fail("height", "a number of pixels from 120 to 2000");
    spec.height = raw.height as number;
  }
  if (raw.where !== undefined) spec.where = compile(String(raw.where));
  if (raw.facet !== undefined) spec.facet = String(raw.facet);
  if (raw.facets !== undefined) {
    if (!Array.isArray(raw.facets)) fail("facets", "a list of the facet values to show, in order");
    spec.facets = (raw.facets as unknown[]).map(String);
  }
  if (raw.labels !== undefined) {
    if (!isRecord(raw.labels)) fail("labels", "a map from a value to the label shown");
    for (const [key, value] of Object.entries(raw.labels as Record<string, unknown>)) spec.labels[key] = String(value);
  }
  if (raw.ranges !== undefined) {
    if (!Array.isArray(raw.ranges)) fail("ranges", "a list, e.g. [1W, 1M, 3M, 1Y, All]");
    spec.ranges = (raw.ranges as unknown[]).map(parseRange);
  }
  if (raw.range !== undefined) {
    spec.range = parseRange(raw.range).label;
    if (spec.ranges && !spec.ranges.some((r) => r.label === spec.range)) spec.ranges.push(parseRange(raw.range));
  }
  if (raw.group !== undefined) spec.group = String(raw.group);
  if (raw.yaxis !== undefined) {
    if (!isRecord(raw.yaxis)) fail("yaxis", "a map: min, max, zero, log, unit");
    const axis = raw.yaxis as Record<string, unknown>;
    if (typeof axis.min === "number") spec.y.min = axis.min;
    if (typeof axis.max === "number") spec.y.max = axis.max;
    if (axis.zero !== undefined) spec.y.zero = axis.zero === true;
    if (axis.log !== undefined) spec.y.log = axis.log === true;
    if (axis.unit !== undefined) spec.y.unit = String(axis.unit);
  }
  if (raw.columns !== undefined) {
    if (!Array.isArray(raw.columns)) fail("columns", "a list of fields");
    spec.columns = (raw.columns as unknown[]).map(String);
  }
  if (raw.sort !== undefined) {
    const sort = String(raw.sort).trim();
    spec.sort = sort.startsWith("-") ? { field: sort.slice(1), desc: true } : { field: sort.replace(/\s+desc$/i, ""), desc: /\s+desc$/i.test(sort) };
  }
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || raw.limit < 1) fail("limit", "a number of rows");
    spec.limit = raw.limit as number;
  }
  return spec;
}
