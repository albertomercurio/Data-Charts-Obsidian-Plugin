// Data Charts: interactive charts of the data files of a vault (CSV, JSON,
// JSON Lines), drawn from `data-chart` blocks in notes. The logic is in src/,
// which knows nothing of Obsidian; src/obsidian/ draws with ECharts.

import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { type Component, MarkdownRenderer, normalizePath, Plugin, type TAbstractFile, TFile } from "obsidian";
import { globMatcher, parseData, type Row } from "./src/data";
import type { ChartSpec } from "./src/spec";
import { ChartBlock, type Host } from "./src/obsidian/block";
import { registerLocales } from "./src/obsidian/locales";

use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);
registerLocales();

export default class DataChartsPlugin extends Plugin implements Host {
  blocks = new Set<ChartBlock>();
  /** Rows of each file read, until the file changes. */
  private cache = new Map<string, { mtime: number; rows: Row[] }>();

  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor("data-chart", (source, el, ctx) => {
      ctx.addChild(new ChartBlock(this, source, el, ctx.sourcePath));
    });
    const changed = (file: TAbstractFile, oldPath?: string) => {
      this.cache.delete(file.path);
      if (oldPath) this.cache.delete(oldPath);
      for (const block of this.blocks) if (block.uses(file.path) || (oldPath && block.uses(oldPath))) block.scheduleReload();
    };
    this.registerEvent(this.app.vault.on("modify", (file) => changed(file)));
    this.registerEvent(this.app.vault.on("create", (file) => changed(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => changed(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => changed(file, oldPath)));
    // The note's own properties, for `this.` in expressions.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => changed(file)));
    this.registerEvent(this.app.workspace.on("css-change", () => this.blocks.forEach((block) => block.retheme())));
  }

  resolve(spec: ChartSpec): string[] {
    const files = this.app.vault.getFiles().map((file) => file.path);
    const paths = new Set<string>();
    for (const pattern of spec.sources) {
      const clean = normalizePath(pattern.replace(/^\/+/, ""));
      if (!clean.includes("*")) {
        if (this.app.vault.getAbstractFileByPath(clean) instanceof TFile) paths.add(clean);
        continue;
      }
      const match = globMatcher(clean);
      for (const path of files) if (match(path)) paths.add(path);
    }
    return [...paths].sort();
  }

  async rows(path: string): Promise<Row[]> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`${path}: file not found`);
    const cached = this.cache.get(path);
    if (cached && cached.mtime === file.stat.mtime) return cached.rows;
    const rows = parseData(path, await this.app.vault.cachedRead(file));
    this.cache.set(path, { mtime: file.stat.mtime, rows });
    return rows;
  }

  self(path: string): Record<string, unknown> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return {};
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    return { ...frontmatter, "file.name": file.basename, "file.path": file.path, "file.folder": file.parent?.path ?? "" };
  }

  async markdown(text: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    await MarkdownRenderer.render(this.app, text, el, sourcePath, component);
  }

  shareRange(from: ChartBlock, label: string): void {
    for (const block of this.blocks) if (block !== from && block.group === from.group) block.applyRange(label, false);
  }
}
