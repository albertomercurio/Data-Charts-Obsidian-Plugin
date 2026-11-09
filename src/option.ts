// From prepared data to the option of an ECharts chart. Marks follow one set of
// rules: 2px lines, 8px points with a ring in the surface color, bars at most
// 24px wide with rounded ends, fills at 10 %, one y axis, recessive axes and
// grid, a legend only for two or more series. Colors come from the theme.

import type { Facet, Point, Prepared } from "./data";
import type { Bucket, ChartSpec, Series } from "./spec";
import { timeAxis, timeLabel, timeUnit } from "./timeaxis";

export interface Theme {
  dark: boolean;
  /** Text: primary, secondary, muted. */
  text: string;
  secondary: string;
  muted: string;
  /** Hairlines: grid and axis. */
  grid: string;
  axis: string;
  surface: string;
  accent: string;
  font: string;
  /** Series colors, in a fixed order. */
  palette: string[];
  /** One hue from the surface outwards, for ordered series. */
  ramp: string[];
  /** Reference bands: the range where values are expected. */
  good: string;
  /** Points outside their reference band. */
  critical: string;
}

/** Categorical colors, in an order checked for color-vision deficiencies; a dark step of each hue for dark themes. */
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
/** One blue from light to dark (on dark themes, from dark to light): every step clears 2:1 against the surface. */
export const RAMP = {
  light: ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"],
  dark: ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4"],
};
/** Names of the palette's colors, in its order: `color: violet` takes the theme's step of that hue. */
export const COLOR_NAMES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];
/** Status colors, the same on light and dark themes: in range, out of range. */
export const GOOD = "#0ca30c";
export const CRITICAL = "#d03b3b";

/** A hex color with an opacity, as rgba(). */
export function alpha(hex: string, opacity: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${opacity})` : hex;
}

/** A color of a block: a name of the palette (light or dark step, as the theme), or any CSS color. */
export function resolveColor(color: string, theme: Theme): string {
  const i = COLOR_NAMES.indexOf(color.trim().toLowerCase());
  return i >= 0 ? theme.palette[i] : color;
}

export const LIGHT: Theme = {
  dark: false,
  text: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  surface: "#fcfcfb",
  accent: "#2a78d6",
  font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  palette: PALETTE.light,
  ramp: RAMP.light,
  good: GOOD,
  critical: CRITICAL,
};

/** Callbacks of the host: tooltip content. */
export interface Hooks {
  tooltip?: (params: unknown) => HTMLElement | string;
}

/** What the time axis needs to place its labels: the window shown, the width of the plot, the language. */
export interface View {
  window: [number, number] | null;
  width: number;
  locale: string;
}

type Option = Record<string, unknown>;

/** Series ids: the bands are drawn as two stacked series that are not listed. */
export const bandId = (i: number, part: "low" | "high") => `band:${i}:${part}`;

/** Compact numbers for the y axis: 950, 9.5K, 12K, 1.25M. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  return String(trim(value));
}
const trim = (value: number) => Math.round(value * 100) / 100;

/** A round step for about five intervals over a span: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const raw = span / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10;
  return step * power;
}

/** Seconds as 5:30 or 1:05:30. */
export function duration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const total = Math.round(Math.abs(seconds));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${sign}${h}:${pad(m)}:${pad(s)}` : `${sign}${m}:${pad(s)}`;
}

/** The color of each series of a block. */
export function seriesColors(spec: ChartSpec, theme: Theme): string[] {
  const n = spec.series.length;
  if (spec.colors === "sequential") {
    const steps = theme.ramp;
    const last = steps.length - 1;
    // Evenly spaced steps, from the one nearest the surface to the farthest.
    return spec.series.map((_, i) => steps[n === 1 ? Math.floor(last / 2) : Math.round((Math.min(i, last) * last) / Math.min(n - 1, last))]);
  }
  if (Array.isArray(spec.colors)) {
    const list = spec.colors;
    return spec.series.map((s, i) => resolveColor(s.color ?? list[i % list.length], theme));
  }
  return spec.series.map((s, i) => (s.color ? resolveColor(s.color, theme) : theme.palette[i % theme.palette.length]));
}

/** The unit of the y axis: the block's, or the one every series shares. */
export function yUnit(spec: ChartSpec): string | undefined {
  if (spec.y.unit !== undefined) return spec.y.unit || undefined;
  const units = new Set(spec.series.map((s) => s.unit ?? ""));
  return units.size === 1 ? [...units][0] || undefined : undefined;
}

/** The bucket shared by every series, when they are all bars of weekly, monthly or yearly totals. */
export function sharedBucket(spec: ChartSpec): Bucket | null {
  const buckets = new Set(spec.series.map((s) => (s.type === "bar" && s.agg?.bucket && s.agg.bucket !== "day" ? s.agg.bucket : null)));
  return buckets.size === 1 ? [...buckets][0] : null;
}

/** The labels of a time axis for what is shown: days, weeks, months…; for spans of hours, ECharts' own. */
export function timeAxisOption(spec: ChartSpec, theme: Theme, view: View, span: [number, number]): Option {
  const shown = view.window ?? span;
  const bucket = sharedBucket(spec);
  const unit = timeUnit(shown[1] - shown[0], view.width, bucket);
  if (!unit) return { axisLabel: { customValues: null, formatter: null }, axisTick: { show: false, customValues: null }, splitLine: { show: false } };
  // Labels for the whole extent, so that panning finds them; the chart shows those in the window.
  const axis = timeAxis(span, unit, bucket === unit);
  return {
    axisLabel: {
      customValues: axis.labels,
      hideOverlap: true,
      formatter: (value: number, index: number) => {
        const named = axis.named.has(value) || index === 0;
        const text = timeLabel(value, unit, named, view.locale);
        return named ? `{named|${text}}` : text;
      },
      rich: { named: { color: theme.secondary, fontWeight: 600, fontFamily: theme.font, fontSize: 11 } },
    },
    axisTick: { show: false, customValues: axis.lines },
    splitLine: { show: axis.lines.length > 0, lineStyle: { color: theme.grid, width: 1, type: "solid" } },
  };
}

function data(points: Point[], series: Series, theme: Theme, tops: Set<number> | null): unknown[] {
  return points.map((p) => {
    // Out of the band: red, and a triangle pointing the way it is out, so that color is not alone.
    const above = series.band && p.high !== undefined && p.y > p.high;
    const below = series.band && p.low !== undefined && p.y < p.low;
    if (above || below) return { value: [p.x, p.y], symbol: "triangle", symbolSize: 11, symbolRotate: above ? 0 : 180, itemStyle: { color: theme.critical } };
    // Stacked bars: only the top of each column is rounded.
    if (tops?.has(p.x)) return { value: [p.x, p.y], itemStyle: { borderRadius: [4, 4, 0, 0] } };
    return [p.x, p.y];
  });
}

function markSeries(prepared: { series: Series; points: Point[] }, i: number, color: string, theme: Theme, tops: Set<number> | null): Option[] {
  const { series, points } = prepared;
  const base: Option = { id: `s:${i}`, name: series.name, data: data(points, series, theme, tops), z: 3, emphasis: { disabled: true } };
  const ring = { color, borderColor: theme.surface, borderWidth: 2 };
  let mark: Option;
  if (series.type === "bar") {
    mark = series.stack
      ? // A gap in the surface color between the parts of a column.
        { ...base, type: "bar", stack: series.stack, barMaxWidth: 24, itemStyle: { color, borderColor: theme.surface, borderWidth: 1, borderRadius: 0 } }
      : { ...base, type: "bar", barMaxWidth: 24, itemStyle: { color, borderRadius: [4, 4, 0, 0] } };
  } else if (series.type === "scatter") {
    mark = { ...base, type: "scatter", symbolSize: 8, itemStyle: ring };
  } else {
    mark = {
      ...base,
      type: "line",
      showSymbol: series.points ?? (points.length <= 40 || Boolean(series.band)),
      symbol: "circle",
      symbolSize: 8,
      itemStyle: ring,
      lineStyle: { width: 2, cap: "round", join: "round", color },
      smooth: series.smooth ?? false,
      ...(series.stack ? { stack: series.stack } : {}),
      ...(points.length > 1500 ? { sampling: "lttb" } : {}),
      ...(series.type === "area" ? { areaStyle: { color, opacity: series.stack ? 0.6 : 0.1 } } : {}),
    };
  }
  if (series.goal !== undefined) {
    mark.markLine = {
      silent: true,
      symbol: "none",
      lineStyle: { color: theme.muted, width: 1, type: "solid" },
      // On a patch of the background, so that a line passing by does not cross the number.
      label: { position: "insideEndTop", color: theme.secondary, backgroundColor: theme.surface, padding: [1, 4], borderRadius: 3, formatter: compact(series.goal) },
      data: [{ yAxis: series.goal }],
    };
  }
  const out: Option[] = [mark];
  if (series.band) {
    const banded = points.filter((p) => p.low !== undefined && p.high !== undefined);
    // A green band with its edges; one point has no area to fill, so its band spans the chart.
    const fill = alpha(theme.good, theme.dark ? 0.16 : 0.12);
    const edge = { color: alpha(theme.good, 0.55), width: 1, type: "solid" };
    if (banded.length === 1) {
      mark.markArea = { silent: true, itemStyle: { color: fill, borderColor: edge.color, borderWidth: 1 }, data: [[{ yAxis: banded[0].low }, { yAxis: banded[0].high }]] };
    }
    const hidden = { type: "line", stack: `band:${i}`, symbol: "none", silent: true, z: 1, step: false, tooltip: { show: false }, emphasis: { disabled: true } };
    const lines = banded.length > 1 ? edge : { opacity: 0 };
    out.unshift(
      { ...hidden, id: bandId(i, "low"), name: bandId(i, "low"), lineStyle: lines, data: banded.map((p) => [p.x, p.low]) },
      { ...hidden, id: bandId(i, "high"), name: bandId(i, "high"), lineStyle: lines, data: banded.map((p) => [p.x, (p.high as number) - (p.low as number)]), areaStyle: { color: fill, opacity: 1 } }
    );
  }
  return out;
}

/** For each stacked bar series, the x where it is the top of its column. */
function stackTops(facet: Facet): (Set<number> | null)[] {
  const tops: (Set<number> | null)[] = facet.series.map(() => null);
  const top = new Map<string, Map<number, number>>();
  facet.series.forEach((s, i) => {
    if (s.series.type !== "bar" || !s.series.stack) return;
    const columns = top.get(s.series.stack) ?? new Map<number, number>();
    for (const p of s.points) if (p.y !== 0) columns.set(p.x, i);
    top.set(s.series.stack, columns);
  });
  for (const columns of top.values()) for (const [x, i] of columns) (tops[i] ??= new Set()).add(x);
  return tops;
}

/** The ECharts option of one facet; with a view, a time axis gets labels chosen for the window and the width. */
export function buildOption(facet: Facet, prepared: Prepared, spec: ChartSpec, theme: Theme, hooks: Hooks = {}, view?: View): Option {
  const visible = facet.series.filter((s) => s.points.length);
  const legend = visible.length >= 2;
  const colors = seriesColors(spec, theme);
  const bars = facet.series.some((s) => s.series.type === "bar");
  const onlyScatter = facet.series.every((s) => s.series.type === "scatter");
  const zero = spec.y.zero ?? bars;
  const filterMode = bars || onlyScatter ? "filter" : "weakFilter";
  const axisText = { color: theme.muted, fontFamily: theme.font, fontSize: 11 };
  const unit = yUnit(spec);
  const valueText = spec.y.format === "duration" ? duration : compact;

  const xAxis: Option = {
    type: prepared.kind,
    axisLine: { lineStyle: { color: theme.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { ...axisText, hideOverlap: true },
    splitLine: { show: false },
    ...(prepared.kind === "category" ? { data: prepared.categories, boundaryGap: true } : { boundaryGap: bars ? ["2%", "2%"] : false }),
    ...(prepared.kind === "value" ? { scale: true } : {}),
  };
  const single = singleX(prepared);
  const drawn = axisSpan(prepared);
  if (single && drawn) Object.assign(xAxis, { min: drawn[0], max: drawn[1] });
  const span = prepared.kind === "time" && view ? drawn : null;
  if (span && view) {
    const time = timeAxisOption(spec, theme, single ? { ...view, window: span } : view, span);
    Object.assign(xAxis, time, { axisLabel: { ...axisText, ...(time.axisLabel as Option) } });
  }
  // With a band, room above and below it, so that the band reads as a band and "outside" is
  // visible; the axis ends and its ticks on round numbers.
  const banded = facet.series.filter((s) => s.series.band).flatMap((s) => s.points);
  let room: Option = {};
  if (banded.length && spec.y.min === undefined && spec.y.max === undefined && !spec.y.log) {
    const values = facet.series.flatMap((s) => s.points.flatMap((p) => [p.y, p.low, p.high])).filter((v): v is number => v !== undefined && Number.isFinite(v));
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
    const step = niceStep(hi - lo + 2 * pad);
    const min = Math.floor((lo - pad) / step) * step;
    room = { min: lo >= 0 ? Math.max(0, min) : min, max: Math.ceil((hi + pad) / step) * step, interval: step };
  }
  const yAxis: Option = {
    type: spec.y.log ? "log" : "value",
    scale: !zero,
    ...room,
    inverse: spec.y.inverse ?? false,
    // Bars grow from zero: the axis includes it (scale: false), negative bars included.
    ...(spec.y.min !== undefined ? { min: spec.y.min } : {}),
    ...(spec.y.max !== undefined ? { max: spec.y.max } : {}),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...axisText, formatter: (v: number) => valueText(v) },
    splitLine: { lineStyle: { color: theme.grid, width: 1, type: "solid" } },
    // The unit above the axis (below it when the axis is upside down, where its top is).
    ...(unit ? { name: unit, nameLocation: spec.y.inverse ? "start" : "end", nameGap: 10, nameTextStyle: { ...axisText, align: "left" } } : {}),
  };
  const tops = stackTops(facet);

  return {
    animationDuration: 300,
    animationDurationUpdate: 200,
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.font, color: theme.secondary },
    grid: { left: 4, right: 16, top: legend && unit ? 46 : legend || unit ? 30 : 12, bottom: single ? 12 : 40, containLabel: true },
    ...(legend
      ? {
          legend: {
            top: 0,
            left: 0,
            itemGap: 16,
            itemWidth: 14,
            itemHeight: 8,
            textStyle: { color: theme.secondary, fontFamily: theme.font, fontSize: 12 },
            // The key mirrors the mark: a stroke for lines, a block for bars and areas, a dot for points.
            // (ECharts draws a stroke for a line when no icon is given.)
            data: visible.map((s) => (s.series.type === "line" ? { name: s.series.name } : { name: s.series.name, icon: s.series.type === "scatter" ? "circle" : "roundRect" })),
          },
        }
      : {}),
    tooltip: {
      trigger: onlyScatter ? "item" : "axis",
      confine: true,
      backgroundColor: theme.surface,
      borderColor: theme.grid,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.text, fontFamily: theme.font, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: theme.muted, width: 1, type: "solid" }, z: 0 },
      ...(hooks.tooltip ? { formatter: hooks.tooltip } : {}),
    },
    xAxis,
    yAxis,
    dataZoom: [
      { type: "inside", filterMode, zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false, moveOnMouseMove: true, preventDefaultMouseMove: false },
      {
        type: "slider",
        // Nothing to slide along when every point has the same x.
        show: !single,
        filterMode,
        height: 16,
        bottom: 6,
        showDetail: false,
        brushSelect: false,
        borderColor: theme.grid,
        backgroundColor: "transparent",
        fillerColor: theme.dark ? "rgba(255,255,255,0.08)" : "rgba(11,11,11,0.06)",
        handleStyle: { color: theme.surface, borderColor: theme.axis },
        moveHandleSize: 0,
        dataBackground: { lineStyle: { color: theme.axis, opacity: 0.6 }, areaStyle: { color: theme.axis, opacity: 0.15 } },
        selectedDataBackground: { lineStyle: { color: theme.muted }, areaStyle: { color: theme.muted, opacity: 0.2 } },
        textStyle: axisText,
      },
    ],
    series: facet.series.flatMap((s, i) => markSeries(s, i, colors[i], theme, tops[i])),
  };
}

/**
 * The extent of the x axis as drawn: weeks and months of totals included whole; a single x
 * (one blood test, one day) gets room around it, a fortnight each side on a time axis.
 */
export function axisSpan(prepared: Prepared): [number, number] | null {
  const whole = extentOf(prepared);
  if (!whole || whole[0] !== whole[1] || prepared.kind === "category") return whole;
  const pad = prepared.kind === "time" ? 15 * 86400000 : 1;
  return [whole[0] - pad, whole[1] + pad];
}

/** Whether every point of the chart has the same x. */
export function singleX(prepared: Prepared): boolean {
  const whole = extentOf(prepared);
  return whole !== null && whole[0] === whole[1] && prepared.kind !== "category";
}

/** The extent of a time axis, weeks and months of totals included whole. */
export function extentOf(prepared: Prepared): [number, number] | null {
  let [min, max] = [Infinity, -Infinity];
  for (const f of prepared.facets) for (const s of f.series) for (const p of s.points) [min, max] = [Math.min(min, p.span?.[0] ?? p.x), Math.max(max, p.span?.[1] ?? p.x)];
  return min <= max ? [min, max] : null;
}

/** The zoom of a window, for an option or an action. */
export function zoomTo(window: [number, number] | null): { start?: number; end?: number; startValue?: number; endValue?: number } {
  return window ? { startValue: window[0], endValue: window[1] } : { start: 0, end: 100 };
}
