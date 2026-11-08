// One `data-chart` block in a note: reads its files, draws one chart per facet
// (or a table), offers range buttons and a table view, follows the theme and
// the size of the pane, and redraws when its files or the note change.

import { connect, type EChartsType, init } from "echarts/core";
import { type Component, MarkdownRenderChild, moment, parseYaml } from "obsidian";
import { extent, filterRows, globMatcher, type Prepared, prepare, type Row, tableRows } from "../data";
import { buildOption, extentOf, seriesColors, sharedBucket, type Theme, timeAxisOption, zoomTo } from "../option";
import { timeUnit } from "../timeaxis";
import { narrows, rangesFor, windowOf } from "../ranges";
import { type ChartSpec, parseSpec, type Range } from "../spec";
import { chartLocale } from "./locales";
import { readTheme } from "./theme";
import { formats, tooltip } from "./tooltip";

export interface Host {
  blocks: Set<ChartBlock>;
  /** Paths in the vault matching the sources of a block. */
  resolve(spec: ChartSpec): string[];
  rows(path: string): Promise<Row[]>;
  /** The properties of a note, for `this.` in expressions. */
  self(path: string): Record<string, unknown>;
  /** Another block of the group chose a range. */
  shareRange(from: ChartBlock, label: string): void;
  /** Renders Markdown (the description) into an element. */
  markdown(text: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void>;
}

/** Room taken by the y axis labels and the margins: the rest is the plot. */
const AXIS_ROOM = 56;

let counter = 0;

export class ChartBlock extends MarkdownRenderChild {
  private spec: ChartSpec | null = null;
  private files: string[] = [];
  private prepared: Prepared | null = null;
  private ranges: Range[] = [];
  private charts: EChartsType[] = [];
  private observer: ResizeObserver | null = null;
  private timer: number | null = null;
  private applying = false;
  private range: string | null = null;
  private showTable = false;
  private theme: Theme | null = null;
  /** The unit of the time axis of each chart, to change its labels only when it changes. */
  private units: (string | null)[] = [];
  private readonly connect = `data-chart-${++counter}`;

  constructor(private host: Host, private source: string, containerEl: HTMLElement, readonly sourcePath: string) {
    super(containerEl);
  }

  get group(): string | null {
    return this.spec?.group ? `${this.sourcePath}::${this.spec.group}` : null;
  }

  onload(): void {
    this.host.blocks.add(this);
    this.containerEl.addClass("data-chart");
    void this.render();
  }

  onunload(): void {
    this.host.blocks.delete(this);
    this.dispose();
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  /** Whether a file changed in the vault is one this block reads, or its note. */
  uses(path: string): boolean {
    if (path === this.sourcePath) return /\bthis\./.test(this.source);
    if (this.files.includes(path)) return true;
    return Boolean(this.spec?.sources.some((pattern) => globMatcher(pattern)(path)));
  }

  /** Redraws a little after the last change: an import writes many files in a row. */
  scheduleReload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.render();
    }, 400);
  }

  /** The theme changed: same data, new colors. */
  retheme(): void {
    if (this.prepared && this.spec && this.charts.length) this.draw(this.spec, this.prepared);
  }

  /** A range chosen in this block or, through the group, in another one. */
  applyRange(label: string, share = true): void {
    const range = this.ranges.find((r) => r.label === label);
    if (!range || !this.prepared) return;
    this.range = label;
    const span = extent(this.prepared);
    const window = span ? windowOf(range, this.prepared.kind, span) : null;
    this.applying = true;
    for (const chart of this.charts) chart.dispatchAction({ type: "dataZoom", ...zoomTo(window) });
    this.applying = false;
    this.refreshAxes();
    this.markRange();
    if (share && this.spec?.group) this.host.shareRange(this, label);
  }

  private dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const chart of this.charts) chart.dispose();
    this.charts = [];
    this.units = [];
  }

  /** The window each chart shows, from its zoom. */
  private shown(chart: EChartsType, span: [number, number]): [number, number] {
    const zoom = (chart.getOption() as { dataZoom?: { start?: number; end?: number }[] }).dataZoom?.[0];
    const [start, end] = [zoom?.start ?? 0, zoom?.end ?? 100];
    return [span[0] + ((span[1] - span[0]) * start) / 100, span[0] + ((span[1] - span[0]) * end) / 100];
  }

  /** Time axes: after a zoom or a resize, labels of days, weeks or months as the window and the width allow. */
  private refreshAxes(): void {
    const { spec, prepared, theme } = this;
    if (!spec || !prepared || !theme || prepared.kind !== "time") return;
    const span = extentOf(prepared);
    if (!span) return;
    this.charts.forEach((chart, i) => {
      const window = this.shown(chart, span);
      const width = chart.getWidth() - AXIS_ROOM;
      const unit = timeUnit(window[1] - window[0], width, sharedBucket(spec));
      if (this.units[i] === unit) return;
      this.units[i] = unit;
      chart.setOption({ xAxis: timeAxisOption(spec, theme, { window, width, locale: moment.locale() }, span) });
    });
  }

  /** The title and, under it, the description in Markdown. */
  private heading(spec: ChartSpec): void {
    const root = this.containerEl;
    if (spec.title) root.createDiv({ cls: "data-chart-title", text: spec.title });
    if (spec.description) void this.host.markdown(spec.description, root.createDiv({ cls: "data-chart-description" }), this.sourcePath, this);
  }

  private async render(): Promise<void> {
    try {
      const spec = parseSpec(this.source, parseYaml);
      this.spec = spec;
      this.files = this.host.resolve(spec);
      if (!this.files.length) throw new Error(`no file matches ${spec.sources.join(", ")}`);
      const rows = (await Promise.all(this.files.map((file) => this.host.rows(file)))).flat();
      const self = this.host.self(this.sourcePath);
      if (spec.type === "table") return this.drawTable(spec, tableRows(filterRows(rows, spec, self), spec));
      const prepared = prepare(rows, spec, self);
      this.prepared = prepared;
      if (!prepared.facets.some((f) => f.series.some((s) => s.points.length))) return this.message(`No data to plot in ${this.files.join(", ")}.`);
      this.draw(spec, prepared);
    } catch (err) {
      this.dispose();
      this.containerEl.empty();
      const box = this.containerEl.createDiv({ cls: "data-chart-error" });
      box.createEl("strong", { text: "Data chart: " });
      box.appendText(err instanceof Error ? err.message : String(err));
    }
  }

  private message(text: string): void {
    this.dispose();
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "data-chart-empty", text });
  }

  private draw(spec: ChartSpec, prepared: Prepared): void {
    const theme = readTheme();
    this.theme = theme;
    const locale = moment.locale();
    const format = formats(prepared, locale, spec);
    const colors = seriesColors(spec, theme);
    const span = extent(prepared);
    this.ranges = span ? rangesFor(prepared.kind, spec.ranges).filter((r) => narrows(r, prepared.kind, span)) : [];
    if (this.range === null || !this.ranges.some((r) => r.label === this.range)) {
      this.range = spec.range && this.ranges.some((r) => r.label === spec.range) ? spec.range : this.ranges.some((r) => r.label === "All") ? "All" : null;
    }
    const current = this.ranges.find((r) => r.label === this.range);
    const window = current && span ? windowOf(current, prepared.kind, span) : null;
    const optionOf = (i: number, width: number) => {
      const facet = prepared.facets[i];
      const option = buildOption(facet, prepared, spec, theme, { tooltip: tooltip(facet, theme, format, colors) }, { window, width: width - AXIS_ROOM, locale });
      for (const zoom of option.dataZoom as Record<string, unknown>[]) Object.assign(zoom, zoomTo(window));
      return option;
    };
    const unitOf = (width: number) => {
      const whole = extentOf(prepared);
      const shown = window ?? whole;
      return prepared.kind === "time" && shown ? timeUnit(shown[1] - shown[0], width - AXIS_ROOM, sharedBucket(spec)) : null;
    };

    // Same facets as before: update in place, keeping the frame (no flash).
    if (this.charts.length && this.charts.length === prepared.facets.length) {
      this.charts.forEach((chart, i) => {
        chart.setOption(optionOf(i, chart.getWidth()), { notMerge: true });
        this.units[i] = unitOf(chart.getWidth());
      });
      this.fillChips();
      this.fillTable(spec, prepared, format);
      return;
    }

    this.dispose();
    const root = this.containerEl;
    root.empty();
    this.heading(spec);
    const toolbar = root.createDiv({ cls: "data-chart-toolbar" });
    toolbar.createDiv({ cls: "data-chart-ranges", attr: { role: "group", "aria-label": "Range" } });
    const tableButton = toolbar.createEl("button", { cls: "data-chart-chip data-chart-table-toggle", text: "Table", attr: { type: "button", "aria-pressed": String(this.showTable) } });
    const faceted = prepared.facets.length > 1;
    const grid = root.createDiv({ cls: `data-chart-grid${faceted ? " is-faceted" : ""}` });
    const table = root.createDiv({ cls: "data-chart-table" });
    table.toggleClass("is-hidden", !this.showTable);
    tableButton.addEventListener("click", () => {
      this.showTable = !this.showTable;
      tableButton.setAttr("aria-pressed", String(this.showTable));
      table.toggleClass("is-hidden", !this.showTable);
    });

    const chartLanguage = chartLocale(locale);
    prepared.facets.forEach((facet, i) => {
      const cell = grid.createDiv({ cls: "data-chart-facet" });
      if (spec.facet) cell.createDiv({ cls: "data-chart-facet-title", text: facet.label });
      const canvas = cell.createDiv({ cls: "data-chart-canvas" });
      canvas.style.height = `${faceted ? Math.max(160, Math.round(spec.height * 0.7)) : spec.height}px`;
      const chart = init(canvas, undefined, { renderer: "canvas", locale: chartLanguage });
      chart.setOption(optionOf(i, chart.getWidth()));
      this.units[i] = unitOf(chart.getWidth());
      chart.group = this.connect;
      // A zoom by hand (wheel with ⌘ or Ctrl, pinch, the slider) leaves every range button off.
      chart.on("datazoom", () => {
        if (!this.applying) {
          this.range = null;
          this.markRange();
          this.refreshAxes();
        }
      });
      this.charts.push(chart);
    });
    // Facets zoom together.
    if (this.charts.length > 1) connect(this.connect);
    this.observer = new ResizeObserver(() => {
      this.charts.forEach((chart) => chart.resize());
      this.refreshAxes();
    });
    this.observer.observe(grid);
    this.fillChips();
    this.fillTable(spec, prepared, format);
  }

  /** The range buttons; none when no range would narrow the view. */
  private fillChips(): void {
    const chips = this.containerEl.querySelector<HTMLElement>(".data-chart-ranges");
    if (!chips) return;
    chips.empty();
    for (const range of this.ranges) {
      const chip = chips.createEl("button", { cls: "data-chart-chip", text: range.label, attr: { "data-range": range.label, type: "button" } });
      chip.addEventListener("click", () => this.applyRange(range.label));
    }
    this.markRange();
  }

  private markRange(): void {
    this.containerEl.querySelectorAll<HTMLElement>(".data-chart-chip[data-range]").forEach((chip) => {
      const on = chip.dataset.range === this.range;
      chip.toggleClass("is-active", on);
      chip.setAttr("aria-pressed", String(on));
    });
  }

  /** The table view: one row per x, a column per series (and per facet). */
  private fillTable(spec: ChartSpec, prepared: Prepared, format: ReturnType<typeof formats>): void {
    const host = this.containerEl.querySelector<HTMLElement>(".data-chart-table");
    if (!host) return;
    host.empty();
    const table = host.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    if (spec.facet) head.createEl("th", { text: spec.facet });
    head.createEl("th", { text: spec.x });
    for (const s of spec.series) head.createEl("th", { text: s.name });
    const body = table.createEl("tbody");
    for (const facet of prepared.facets) {
      const xs = [...new Set(facet.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => b - a);
      const values = facet.series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
      // Weeks and months of totals are named by their span.
      const spans = new Map<number, string>();
      for (const s of facet.series) for (const p of s.points) if (p.span && s.series.agg?.bucket) spans.set(p.x, format.span(p.span, s.series.agg.bucket));
      for (const x of xs) {
        const tr = body.createEl("tr");
        if (spec.facet) tr.createEl("td", { text: facet.label });
        tr.createEl("td", { text: spans.get(x) ?? format.x(x) });
        values.forEach((map) => {
          const v = map.get(x);
          tr.createEl("td", { text: v === undefined ? "" : format.number(v), cls: "data-chart-number" });
        });
      }
    }
  }

  private drawTable(spec: ChartSpec, rows: Row[]): void {
    this.dispose();
    const root = this.containerEl;
    root.empty();
    this.heading(spec);
    if (!rows.length) {
      root.createDiv({ cls: "data-chart-empty", text: "No rows match." });
      return;
    }
    const columns = spec.columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 10);
    const number = new Intl.NumberFormat(moment.locale(), { maximumFractionDigits: 3 });
    const table = root.createDiv({ cls: "data-chart-table" }).createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const column of columns) head.createEl("th", { text: column });
    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      for (const column of columns) {
        const value = row[column];
        const text = value === undefined || value === null ? "" : typeof value === "number" ? number.format(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
        tr.createEl("td", { text, cls: typeof value === "number" ? "data-chart-number" : "" });
      }
    }
  }
}
