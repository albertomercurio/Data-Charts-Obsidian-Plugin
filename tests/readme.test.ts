// The examples of the README are blocks the plugin reads, and they draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { filterRows, prepare } from "../src/data";
import { buildOption, LIGHT } from "../src/option";
import { parseSpec } from "../src/spec";

const blocks = [...readFileSync("README.md", "utf8").matchAll(/```data-chart\n([\s\S]*?)```/g)].map((m) => m[1]);

const rows: Record<string, unknown>[] = [
  ...Array.from({ length: 30 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, "0")}`, steps: 8000 + i * 100, sport: i % 3 ? "running" : "walking", distance_km: 5 + (i % 4), hr_avg: 150, duration_min: 30 + i, pace_s_km: 330 + i, z1_min: i, z2_min: 10, z3_min: 2, t: i, hr: 120 + i })),
  { date: "2026-03-02", analyte: "ferritin", value: 20, low: 30, high: 400, unit: "ng/mL" },
  { date: "2026-06-02", analyte: "ferritin", value: 60, low: 30, high: 400, unit: "ng/mL" },
];

test("every example of the README is a valid block", () => {
  assert.ok(blocks.length >= 6, String(blocks.length));
  for (const block of blocks) assert.doesNotThrow(() => parseSpec(block, parse), block);
});

test("the examples draw from data", () => {
  for (const block of blocks) {
    const spec = parseSpec(block, parse);
    if (spec.type === "table") {
      assert.equal(filterRows(rows, spec, { Date: "2026-03-02" }).length, 2);
      continue;
    }
    const prepared = prepare(rows, spec);
    const option = buildOption(prepared.facets[0], prepared, spec, LIGHT) as { series: unknown[] };
    assert.ok(option.series.length >= spec.series.length, block);
    assert.ok(prepared.facets.some((f) => f.series.some((s) => s.points.length)), block);
  }
});
