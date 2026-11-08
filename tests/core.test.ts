import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { axisKind, bucketStart, extent, globMatcher, parseCsv, parseData, parseTime, prepare, tableRows } from "../src/data";
import { compile, test as holds } from "../src/expr";
import { bandId, buildOption, compact, LIGHT } from "../src/option";
import { narrows, rangesFor, windowOf } from "../src/ranges";
import { parseRange, parseSpec } from "../src/spec";

const spec = (yaml: string) => parseSpec(yaml, parse);
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

test("expressions: fields, arithmetic, comparisons, lists, this, links", () => {
  const row = { analyte: "ferritin", value: "85", date: "2026-10-15", sport: "running", distance_km: 10, hr_avg: 150, duration_min: 60, "End Date": "2026-12-01" };
  assert.equal(holds(compile('analyte == "ferritin" and date >= "2026-01-01"'), row), true);
  assert.equal(holds(compile("value > 80 && value < 90"), row), true);
  assert.equal(holds(compile('sport in ["running", "walking"]'), row), true);
  assert.equal(holds(compile('not sport == "walking"'), row), true);
  assert.equal(compile("distance_km * 1000 / (hr_avg * duration_min)")(row), 10000 / 9000);
  assert.equal(compile("-distance_km + 2")(row), -8);
  assert.equal(holds(compile("date == this.Date"), row, { Date: "2026-10-15" }), true);
  assert.equal(holds(compile('this.Patient == "Jane Doe"'), row, { Patient: "[[Jane Doe]]" }), true);
  assert.equal(holds(compile('`End Date` > "2026-11-01"'), row), true);
  assert.equal(compile("value / 0")(row), null);
  assert.deepEqual(compile('a + b * 2 > c and d == "x"').fields.sort(), ["a", "b", "c", "d"]);
  assert.throws(() => compile("value >"), /unexpected end/);
  assert.throws(() => compile("value @ 3"), /unexpected "@"/);
});

test("the specification: shorthand, series, defaults, errors that say what to write", () => {
  const s = spec("source: data.jsonl\nx: date\ny: steps\ntype: bar\nname: Steps\ngoal: 10000\nrange: 3M");
  assert.deepEqual([s.sources, s.x, s.type, s.series[0].type, s.series[0].name, s.series[0].goal, s.range], [["data.jsonl"], "date", "bar", "bar", "Steps", 10000, "3M"]);
  const two = spec("source: [a.csv, b.csv]\nx: {field: t, type: value}\nseries:\n  - y: hr\n  - {y: pace_s_km, type: scatter, rolling: 7d, agg: week/avg}");
  assert.equal(two.xKind, "value");
  assert.deepEqual(two.series.map((s) => s.type), ["line", "scatter"]);
  assert.deepEqual(two.series[1].rolling, { ms: 7 * 86400000 });
  assert.deepEqual(two.series[1].agg, { bucket: "week", fn: "avg" });
  assert.equal(spec("source: r.jsonl\ntype: table\ncolumns: [a, b]\nsort: -date\nlimit: 5").sort?.desc, true);
  assert.throws(() => spec("x: date\ny: steps"), { message: /^source:/ });
  assert.throws(() => spec("source: a.csv\ny: steps"), { message: /^x:/ });
  assert.throws(() => spec("source: a.csv\nx: date\ny: steps\ncolour: red"), /colour: unknown key/);
  assert.throws(() => spec("source: a.csv\nx: date\ny: steps\nagg: fortnight/sum"), /agg: "fortnight"/);
  assert.throws(() => spec("source: a.csv\nx: date\ny: steps\ntype: pie"), /type: "pie"/);
});

test("ranges: durations, YTD, All, the last N, windows", () => {
  assert.deepEqual(parseRange("3M"), { label: "3M", kind: "duration", months: 3 });
  assert.deepEqual(parseRange("1w"), { label: "1W", kind: "duration", ms: 7 * 86400000 });
  assert.deepEqual(parseRange(50), { label: "50", kind: "last", n: 50 });
  assert.deepEqual(parseRange({ "First 5 km": [0, 5] }), { label: "First 5 km", kind: "window", from: 0, to: 5 });
  assert.throws(() => parseRange("fortnight"), /not a range/);

  const span: [number, number] = [local(2024, 1, 1), local(2026, 3, 31)];
  assert.deepEqual(windowOf(parseRange("1M"), "time", span), [local(2026, 2, 28), local(2026, 3, 31)]);
  assert.deepEqual(windowOf(parseRange("YTD"), "time", span), [local(2026, 1, 1), local(2026, 3, 31)]);
  assert.equal(windowOf(parseRange("All"), "time", span), null);
  assert.deepEqual(windowOf(parseRange(10), "value", [0, 42]), [32, 42]);
  assert.deepEqual(windowOf(parseRange(3), "category", [0, 9]), [7, 9]);
  assert.deepEqual(windowOf(parseRange({ early: ["2024-01-01", "2024-06-30"] }), "time", span), [local(2024, 1, 1), local(2024, 6, 30)]);
  // Two months of data: 3M and longer would show everything, so they are left out.
  const short: [number, number] = [local(2026, 9, 1), local(2026, 11, 1)];
  assert.deepEqual(rangesFor("time", undefined).filter((r) => narrows(r, "time", short)).map((r) => r.label), ["1W", "1M", "All"]);
  assert.deepEqual(rangesFor("value", undefined), []);
});

test("files: JSON Lines, JSON, CSV with quotes and semicolons", () => {
  assert.deepEqual(parseData("a.jsonl", '{"a":1}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseData("a.json", '{"data":[{"a":1}]}'), [{ a: 1 }]);
  assert.deepEqual(parseCsv('date,name,value\n2026-01-01,"Smith, J.",1.5\n2026-01-02,"He said ""hi""",\n'), [
    { date: "2026-01-01", name: "Smith, J.", value: 1.5 },
    { date: "2026-01-02", name: 'He said "hi"' },
  ]);
  assert.deepEqual(parseData("a.csv", "x;y\n1;2\n"), [{ x: 1, y: 2 }]);
  assert.throws(() => parseData("a.jsonl", "{bad"), /line 1: not valid JSON/);
  assert.throws(() => parseData("a.xlsx", ""), /only \.csv/);
});

test("paths: patterns with * and **", () => {
  assert.ok(globMatcher("Data/*/daily.jsonl")("Data/Jane/daily.jsonl"));
  assert.ok(!globMatcher("Data/*/daily.jsonl")("Data/Jane/x/daily.jsonl"));
  assert.ok(globMatcher("Data/**/*.jsonl")("Data/Jane/Workouts/a.jsonl"));
  assert.ok(globMatcher("Data/a.csv")("Data/a.csv"));
});

test("the x axis: dates in local time, numbers, names", () => {
  assert.equal(parseTime("2026-03-02"), local(2026, 3, 2));
  assert.equal(parseTime("2026-03-02T10:00:00+01:00"), Date.parse("2026-03-02T09:00:00Z"));
  assert.equal(parseTime("2026-02-30"), null);
  assert.equal(axisKind(["2026-01-01", "2026-01-02T10:00"]), "time");
  assert.equal(axisKind([1, "2.5", 3]), "value");
  assert.equal(axisKind(["a", 1]), "category");
  assert.equal(bucketStart(local(2026, 11, 8), "week"), local(2026, 11, 2));
  assert.equal(bucketStart(local(2026, 11, 8), "month"), local(2026, 11, 1));
});

const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, "0")}`, steps: 1000 * (i + 1), kind: i % 2 ? "b" : "a" }));

test("prepare: filter, aggregation by week, moving averages", () => {
  const weekly = prepare(days, spec("source: d.jsonl\nx: date\ny: steps\nagg: week/sum\nwhere: steps > 2000"));
  assert.equal(weekly.kind, "time");
  assert.equal(weekly.datesOnly, true);
  // 2 March 2026 is a Monday: days 3–8 in its week (1 March, a Sunday, belongs to the week before and is filtered out anyway).
  assert.deepEqual(weekly.facets[0].series[0].points.map((p) => [new Date(p.x).getDate(), p.y]), [[2, 3000 + 4000 + 5000 + 6000 + 7000 + 8000], [9, 9000 + 10000 + 11000 + 12000 + 13000 + 14000]]);
  const rolling = prepare(days, spec("source: d.jsonl\nx: date\ny: steps\nrolling: 7"));
  assert.equal(rolling.facets[0].series[0].points.length, 8);
  assert.equal(rolling.facets[0].series[0].points[0].y, 4000);
  const timeWindow = prepare(days, spec("source: d.jsonl\nx: date\ny: steps\nrolling: 2d"));
  assert.deepEqual(timeWindow.facets[0].series[0].points.slice(0, 3).map((p) => p.y), [1000, 1500, 2500]);
});

test("prepare: facets in the order asked, labels, bands", () => {
  const labs = [
    { date: "2026-01-10", analyte: "iron", value: 50, low: 65, high: 175 },
    { date: "2026-01-10", analyte: "ferritin", value: 85, low: 30, high: 400 },
    { date: "2026-06-10", analyte: "ferritin", value: 20, low: 30, high: 400 },
    { date: "2026-06-10", analyte: "glucose", value: 90 },
  ];
  const p = prepare(labs, spec("source: l.jsonl\nx: date\ny: value\nfacet: analyte\nfacets: [ferritin, iron]\nlabels: {ferritin: Ferritina}\nband: [low, high]\npoints: true"));
  assert.deepEqual(p.facets.map((f) => [f.key, f.label]), [["ferritin", "Ferritina"], ["iron", "iron"]]);
  assert.deepEqual(p.facets[0].series[0].points.map((pt) => [pt.y, pt.low, pt.high]), [[85, 30, 400], [20, 30, 400]]);
  assert.deepEqual(extent(p), [local(2026, 1, 10), local(2026, 6, 10)]);
});

test("tables: sorted and limited", () => {
  const s = spec("source: d.jsonl\ntype: table\nsort: steps desc\nlimit: 2");
  assert.deepEqual(tableRows(days, s).map((r) => r.steps), [14000, 13000]);
});

test("the chart option: marks, one axis, legend only for two series, bands, goals, out-of-range points", () => {
  const labs = [
    { date: "2026-01-10", value: 85, low: 30, high: 400 },
    { date: "2026-06-10", value: 20, low: 30, high: 400 },
  ];
  const s = spec("source: l.jsonl\nx: date\ny: value\nband: [low, high]");
  const p = prepare(labs, s);
  const option = buildOption(p.facets[0], p, s, LIGHT) as any;
  assert.equal(option.legend, undefined);
  assert.equal(Array.isArray(option.yAxis), false);
  const ids = option.series.map((x: any) => x.id);
  assert.deepEqual(ids, [bandId(0, "low"), bandId(0, "high"), "s:0"]);
  const line = option.series[2];
  assert.equal(line.lineStyle.width, 2);
  assert.equal(line.symbolSize, 8);
  assert.equal(line.itemStyle.borderWidth, 2);
  assert.equal(line.showSymbol, true);
  assert.deepEqual(line.data[1], { value: [local(2026, 6, 10), 20], itemStyle: { color: LIGHT.critical } });
  assert.deepEqual(option.series[1].data[0], [local(2026, 1, 10), 370]);
  assert.equal(option.series[1].areaStyle.opacity, 0.12);

  const bars = spec("source: d.jsonl\nx: date\nseries:\n  - {y: steps, type: bar, goal: 10000}\n  - {y: steps, rolling: 7, name: Average}");
  const pb = prepare(days, bars);
  const ob = buildOption(pb.facets[0], pb, bars, LIGHT) as any;
  assert.equal(ob.legend.data.length, 2);
  assert.equal(ob.yAxis.scale, false);
  assert.equal(ob.yAxis.min, undefined);
  assert.equal(ob.series[0].barMaxWidth, 24);
  assert.deepEqual(ob.series[0].itemStyle.borderRadius, [4, 4, 0, 0]);
  assert.equal(ob.series[0].markLine.data[0].yAxis, 10000);
  assert.deepEqual(ob.series.map((x: any) => x.lineStyle?.color ?? x.itemStyle.color), [LIGHT.palette[0], LIGHT.palette[1]]);
  assert.equal(ob.dataZoom[0].zoomOnMouseWheel, "ctrl");
});

test("compact numbers for the y axis", () => {
  assert.deepEqual([compact(950), compact(9500), compact(12000), compact(1250000), compact(1.234)], ["950", "9,500", "12K", "1.25M", "1.23"]);
});
