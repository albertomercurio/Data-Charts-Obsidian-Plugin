// From prepared data to the option of an ECharts chart. Marks follow one set of
// rules: 2px lines, 8px points with a ring in the surface color, bars at most
// 24px wide with rounded ends, fills at 10 %, one y axis, recessive axes and
// grid, a legend only for two or more series. Colors come from the theme.

import type { Facet, Point, Prepared } from "./data";
import type { ChartSpec, Series } from "./spec";

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
  /** Points outside their reference band. */
  critical: string;
}

/** Categorical colors, in an order checked for color-vision deficiencies; a dark step of each hue for dark themes. */
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
export const CRITICAL = "#d03b3b";

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
  critical: CRITICAL,
};

/** Callbacks of the host: tooltip content. */
export interface Hooks {
  tooltip?: (params: unknown) => HTMLElement | string;
}


type Option = Record<string, unknown>;

/** Series ids: the bands are drawn as two stacked series that are not listed. */
export const bandId = (i: number, part: "low" | "high") => `band:${i}:${part}`;

/** Compact numbers for the y axis: 950, 9,500, 12K, 1.2M. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3)}K`;
  return Number.isInteger(value) ? value.toLocaleString("en-US") : String(trim(value));
}
const trim = (value: number) => Math.round(value * 100) / 100;

function data(points: Point[], series: Series, theme: Theme): unknown[] {
  return points.map((p) => {
    const out = series.band && ((p.low !== undefined && p.y < p.low) || (p.high !== undefined && p.y > p.high));
    return out ? { value: [p.x, p.y], itemStyle: { color: theme.critical } } : [p.x, p.y];
  });
}

function markSeries(prepared: { series: Series; points: Point[] }, i: number, theme: Theme): Option[] {
  const { series, points } = prepared;
  const color = series.color ?? theme.palette[i % theme.palette.length];
  const base: Option = { id: `s:${i}`, name: series.name, data: data(points, series, theme), z: 3, emphasis: { disabled: true } };
  const ring = { color, borderColor: theme.surface, borderWidth: 2 };
  let mark: Option;
  if (series.type === "bar") {
    mark = { ...base, type: "bar", barMaxWidth: 24, itemStyle: { color, borderRadius: [4, 4, 0, 0] } };
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
      ...(points.length > 1500 ? { sampling: "lttb" } : {}),
      ...(series.type === "area" ? { areaStyle: { color, opacity: 0.1 } } : {}),
    };
  }
  if (series.goal !== undefined) {
    mark.markLine = {
      silent: true,
      symbol: "none",
      lineStyle: { color: theme.muted, width: 1, type: "solid" },
      label: { position: "insideEndTop", color: theme.muted, formatter: compact(series.goal) },
      data: [{ yAxis: series.goal }],
    };
  }
  const out: Option[] = [mark];
  if (series.band) {
    const banded = points.filter((p) => p.low !== undefined && p.high !== undefined);
    const hidden = { type: "line", stack: `band:${i}`, symbol: "none", silent: true, z: 1, lineStyle: { opacity: 0 }, tooltip: { show: false }, emphasis: { disabled: true } };
    out.unshift(
      { ...hidden, id: bandId(i, "low"), name: bandId(i, "low"), data: banded.map((p) => [p.x, p.low]) },
      { ...hidden, id: bandId(i, "high"), name: bandId(i, "high"), data: banded.map((p) => [p.x, (p.high as number) - (p.low as number)]), areaStyle: { color, opacity: 0.12 } }
    );
  }
  return out;
}

/** The ECharts option of one facet. */
export function buildOption(facet: Facet, prepared: Prepared, spec: ChartSpec, theme: Theme, hooks: Hooks = {}): Option {
  const visible = facet.series.filter((s) => s.points.length);
  const legend = visible.length >= 2;
  const bars = facet.series.some((s) => s.series.type === "bar");
  const onlyScatter = facet.series.every((s) => s.series.type === "scatter");
  const zero = spec.y.zero ?? bars;
  const filterMode = bars || onlyScatter ? "filter" : "weakFilter";
  const axisText = { color: theme.muted, fontFamily: theme.font, fontSize: 11 };

  const xAxis: Option = {
    type: prepared.kind,
    axisLine: { lineStyle: { color: theme.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { ...axisText, hideOverlap: true },
    splitLine: { show: false },
    ...(prepared.kind === "category" ? { data: prepared.categories, boundaryGap: true } : { boundaryGap: bars ? ["2%", "2%"] : false }),
    ...(prepared.kind === "value" ? { scale: true } : {}),
  };
  const yAxis: Option = {
    type: spec.y.log ? "log" : "value",
    scale: !zero,
    // Bars grow from zero: the axis includes it (scale: false), negative bars included.
    ...(spec.y.min !== undefined ? { min: spec.y.min } : {}),
    ...(spec.y.max !== undefined ? { max: spec.y.max } : {}),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...axisText, formatter: (v: number) => compact(v) },
    splitLine: { lineStyle: { color: theme.grid, width: 1, type: "solid" } },
    ...(spec.y.unit ? { name: spec.y.unit, nameLocation: "end", nameGap: 8, nameTextStyle: { ...axisText, align: "left" } } : {}),
  };

  return {
    animationDuration: 300,
    animationDurationUpdate: 200,
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.font, color: theme.secondary },
    grid: { left: 4, right: 16, top: legend || spec.y.unit ? 32 : 12, bottom: 40, containLabel: true },
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
    series: facet.series.flatMap((s, i) => markSeries(s, i, theme)),
  };
}

/** The zoom of a window, for an option or an action. */
export function zoomTo(window: [number, number] | null): { start?: number; end?: number; startValue?: number; endValue?: number } {
  return window ? { startValue: window[0], endValue: window[1] } : { start: 0, end: 100 };
}
