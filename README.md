# Data Charts for Obsidian

Interactive, responsive charts of the data files in your vault — CSV, JSON and JSON Lines — written as a small YAML block in any note.

- **Any x axis**: dates (a time axis), numbers or names, detected from the data.
- **Range buttons**: `1W`, `1M`, `3M`, `6M`, `1Y`, `3Y`, `YTD`, `All` on a time axis; the last N units or categories, or named windows, on any axis. Buttons that would show everything are left out. Charts of a `group` in a note share their range.
- **Zoom and pan**: ⌘/Ctrl + wheel, trackpad or touch pinch, drag, and a slider.
- **Series**: lines, areas, bars, points; moving averages by points or by time (`7d`); aggregation by day, week, month or year; expressions (`distance_km * 1000 / (hr_avg * duration_min)`).
- **Reference bands**: a shaded range from two fields of each row (lab reference intervals, targets); points outside it are marked and the tooltip says so.
- **Small multiples**: `facet` draws one chart per value of a field (one per lab test, per sport…), zooming together.
- **Tables**: a table view of every chart, and `type: table` for rows filtered by the note itself (`where: date == this.Date`).
- **Live**: a chart redraws when its files change — an import running in the background updates the note you are reading.
- **Theme**: colors, fonts and dark mode follow Obsidian; a color-blind-safe palette; works on iPhone and iPad.

Data files are read from the vault and never leave it.

## A first chart

````markdown
```data-chart
title: Steps per day
source: Data/daily.csv
x: date
range: 3M
series:
  - {y: steps, name: Steps, type: bar, goal: 10000}
  - {y: steps, name: 7-day average, rolling: 7d}
```
````

`Data/daily.csv`:

```csv
date,steps
2026-03-01,8123
2026-03-02,10456
```

## The block

| Key | | Example |
| --- | --- | --- |
| `source` | File, list of files, or pattern (`*` within a folder, `**` across folders), from the vault's root. `.csv`, `.tsv`, `.json` (an array, or the first array of objects in the file), `.jsonl` | `Data/Runs/*.jsonl` |
| `x` | Field of the horizontal axis; `{field: t, type: value}` to force `time`, `value` or `category` | `date` |
| `y` | One series: a field or an expression. For more, `series` | `weight_kg` |
| `series` | List of series, each with `y` and any series key below | |
| `type` | `line` (default), `area`, `bar`, `scatter`, or `table` | `bar` |
| `title` | Shown above the chart | |
| `where` | Keeps the rows for which the expression holds | `sport == "running"` |
| `range` | Range shown first | `3M` |
| `ranges` | Range buttons, replacing the default ones | `[1W, 1M, 1Y, All]` |
| `group` | Charts of the note with the same group share their range | `running` |
| `facet` | One chart per value of this field | `analyte` |
| `facets` | Which values, in which order | `[hemoglobin, ferritin]` |
| `labels` | Names shown for facet values | `{ferritin: Ferritin (ng/mL)}` |
| `yaxis` | `min`, `max`, `zero` (include zero), `log`, `unit` | `{zero: true}` |
| `height` | Pixels, 120–2000 (default 300) | `240` |
| `columns`, `sort`, `limit` | For `type: table`: fields shown, order (`-date` or `date desc`), number of rows | |

Series keys — also accepted at the top level, for every series:

| Key | | Example |
| --- | --- | --- |
| `name` | Legend and tooltip | `Resting heart rate` |
| `type` | `line`, `area`, `bar`, `scatter` | |
| `rolling` | Moving average: a number of points, or a time window | `7`, `7d`, `4w` |
| `agg` | Aggregation: `bucket/function` on a time axis (buckets `day`, `week`, `month`, `year`), or a function alone to merge equal x. Functions `sum`, `avg`, `min`, `max`, `last`, `count` | `week/sum` |
| `band` | Two fields or expressions: a shaded range | `[low, high]` |
| `goal` | A horizontal line | `10000` |
| `points` | Show every point (default: when there are at most 40) | `true` |
| `smooth` | Smooth the line | `true` |
| `unit` | After values in the tooltip | `kg` |
| `color` | A CSS color, instead of the palette's next one | `"#2a78d6"` |

There is never a second y axis: two measures of different scale go in two charts, which a `group` keeps on the same range.

## Ranges

On a time axis, a range counts back from the latest date: `12h`, `7d`, `2w`, `3m` (months), `1y`, and `YTD`, `All`. On any axis, a number is the last N units of x (or the last N categories), and `{label: [from, to]}` is a fixed window:

```data-chart
title: Heart rate during a run
source: Data/Runs/2026-03-02.jsonl
x: t
y: hr
name: Heart rate
unit: bpm
ranges: [10, {First 10 minutes: [0, 10]}, All]
```

## Expressions

`where`, `y` and `band` take expressions: fields, numbers, `"strings"`, `+ - * / %`, `== != < <= > >=`, `and or not` (or `&& || !`), `in [..]`, parentheses. Dates in ISO format compare as text. `this.<property>` is a property of the note holding the chart; a link `[[Note]]` compares as `Note`. Names with spaces go in backticks: `` `End Date` ``.

```data-chart
title: Efficiency — metres per heartbeat
source: Data/workouts.jsonl
where: sport == "running" and distance_km >= 2
x: date
series:
  - {y: distance_km * 1000 / (hr_avg * duration_min), name: m per beat, points: true}
  - {y: distance_km * 1000 / (hr_avg * duration_min), name: 5-run average, rolling: 5}
```

## Lab results with reference bands

```data-chart
title: Blood tests
source: Data/labs.jsonl
x: date
y: value
band: [low, high]
facet: analyte
facets: [hemoglobin, ferritin, iron]
labels: {hemoglobin: Hemoglobin (g/dL), ferritin: Ferritin (ng/mL), iron: Iron (µg/dL)}
points: true
range: All
```

And in the note of one report, its values:

```data-chart
type: table
source: Data/labs.jsonl
where: date == this.Date
columns: [analyte, value, unit, low, high, flag]
sort: analyte
```

## Weekly totals

```data-chart
title: Kilometres per week
source: Data/workouts.jsonl
where: sport == "running"
x: date
y: distance_km
type: bar
agg: week/sum
unit: km
range: 6M
```

## Design

Marks are thin and quiet: 2px lines, 8px points with a ring in the background color, bars at most 24px wide with rounded ends, fills at 10 %, a hairline grid, a legend only for two or more series. Series take a fixed order of eight colors chosen to stay distinct for color-vision deficiencies, with their own steps for dark themes; text uses the theme's text colors, never a series color. Tooltips list every series at the x under the pointer, value first. Every chart has a table view.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build      # dist/main.js; with VAULT_PLUGIN_DIR=<vault>/.obsidian/plugins/data-charts, also installed there
```

`src/` holds the logic and knows nothing of Obsidian or of the chart library: the expression language (`expr.ts`), the block (`spec.ts`), files and series (`data.ts`), ranges (`ranges.ts`) and the ECharts option (`option.ts`); `src/obsidian/` draws with [Apache ECharts](https://echarts.apache.org), importing only the parts it uses. The tests run with Node's test runner; the examples of this README are among them. MIT license.
