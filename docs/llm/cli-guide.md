# SourceSink: a guide for language models

This document is written for an AI agent that has never seen SourceSink. It
describes the command line and the MCP server exactly as they behave today.
Every command shown in a `bash verified` block was executed against this
checkout; sections not marked verified describe behavior read from the source.

If a command, flag, default or output shape is not in this guide, do not infer
it. Read the source file named in the section instead.

## 1. What SourceSink is

SourceSink is an open-source stock-and-flow system-dynamics modeling tool
(TypeScript, ESM, Node.js 22.19 or newer). It reads and writes XMILE (the OASIS
open standard), imports legacy `.stm`/`.itm` model files, simulates
models with a pure engine, and offers calibration, sensitivity, uncertainty,
explanation and a validated patch protocol for AI-authored edits.

The two surfaces for an agent are:

- `src/cli/src/run.ts` — the `sourcesink` command (`run`, `sweep`,
  `montecarlo`, `convert`, `explain`, `fit`, `sensitivity`, `units`).
- `src/mcp/src/server.ts` — an MCP stdio server exposing twelve `model.*`
  tools and two read-only resources.

## 2. Mental model

A model is a directed set of named elements plus a run specification.

| Concept | IR field / XMILE element | Meaning |
| --- | --- | --- |
| Stock | `stocks`, `<stock>` | An accumulation (level). Its `equation` is the **initial value**, not a rate. |
| Flow | `flows`, `<flow>` | A rate. Its `equation` is the rate in stock-units per time unit. |
| Converter (auxiliary) | `converters`, `<aux>` | A derived or constant value; no state. |
| Connector | `connectors`, `<connector>` | An information link. It never moves material. |
| Graphical function | `graphFunctions`, `<gf>` | A lookup from x to y, used inside equations like a function of one argument. |
| Array / subscript | `dimensions`, `arrayed`, `<dimensions>`, `<element>` | A dimensioned element; one scalar series per label combination, e.g. `Prey[North,Deer]`. |
| Run spec | `run`, `<sim_specs>` | `start`, `stop`, `dt`, `saveEvery`, `integration`, `timeUnits`. |

Rules that matter:

- Stocks change only through flows. A stock lists its flows in
  `inflows`/`outflows`; an unattached end is a cloud (outside the model).
- A flow moves material from at most one stock to at most one stock.
- Connectors are informational. A connector that points **into** a stock is a
  structural error.
- Element names are the cross-reference identity. Matching is
  case-insensitive and treats spaces and underscores as the same character
  (`DO deficit`, `do_deficit` and `DO_deficit` are one name).
- Analysis "parameters" are elements. Setting a stock parameter replaces its
  **initial value**; setting a flow or converter parameter replaces its
  **equation** with a constant. Graph functions cannot be parameters.

## 3. Invocation and exit codes

Installed:

```bash
sourcesink <command> [arguments]
```

From a source checkout (the form used by the verified examples):

```bash
npx tsx src/cli/src/run.ts <command> [arguments]
# equivalent and slightly faster to spawn:
node --import tsx src/cli/src/run.ts <command> [arguments]
```

All examples below write `sourcesink`; substitute the checkout form if the
binary is not installed. Paths are relative to the repository root.

| Exit code | Meaning | Examples |
| --- | --- | --- |
| `0` | Success, including `units` finding problems and a run that produced `NaN`/`Infinity`. | `run`, `units`, `fit` |
| `1` | The model or a file is unusable. | missing file (`ENOENT`), invalid XML/XMILE, structural validation failure, legacy import failure, simulation exception |
| `2` | The command line is wrong. | no command, unknown option, missing required value, bad `--param`/`--metric`/`--method`, unknown element or scenario, duplicate parameter |

Human-readable results go to stdout in both success and error cases except
diagnostics: errors always go to stderr; legacy import notes and
`fit --write` confirmations also go to stderr. Nothing is interactive.

Run without a command, or with an unknown command, prints the usage block
shown by `src/cli/src/run.ts` and exits 2.

## 4. Command reference

Common grammar across commands:

- Flags accept `--name value` and `--name=value`.
- Repeatable flags (`--param`, `--set`, `--rename`) keep every value; the
  last value of a single-valued flag wins.
- `--columns a,b,c` splits on commas, except commas inside `[...]`, so
  array names such as `Pop[North,Old]` stay whole.
- A parameter name is resolved case-insensitively with spaces ≡ underscores.
  Duplicate `--param`s that resolve to the same element are rejected.

### `run`

Simulate one model and print every saved row.

```
sourcesink run <model.xmile|model.stm|model.itm> [--json]
              [--columns a,b,c] [--method euler|rk2|rk4|rk45]
              [--scenario <name|id>] [--set NAME=VALUE]...
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| positional model | path | required | XMILE file, or a legacy `.stm`/`.itm` file (imported first). |
| `--json` | switch | off | Print one JSON object instead of CSV. |
| `--columns` | comma list | all series | CSV columns to print. Ignored by `--json`, which always prints every series. |
| `--method` | enum | the model's `sim_specs` method, else `euler` | `euler`, `rk2`, `rk4`, `rk45`. `rk45` takes adaptive Dormand-Prince 5(4) sub-steps inside each `dt`. |
| `--scenario` | text | none | Apply a named model scenario before `--set`. Matches id or name, case-insensitively, spaces ≡ underscores. |
| `--set` | `NAME=VALUE`, repeatable | none | Override an element. A numeric right side becomes a number; anything else is an equation string. Applied after `--scenario`. |

The model is parsed, then structurally validated. Validation errors print
`model validation failed:` with one bullet per error and exit 1.

CSV output: header `time,<column>,...`; one row per saved time. Integers print
without decimals; all other numbers print with exactly six decimals. A
requested column that does not exist prints `NaN` for every row and still
exits 0 — check the header, not the exit code.

```bash verified
sourcesink run examples/ecology/sir-epidemic.xmile --columns Susceptible,Infectious --method rk4
```

```
time,Susceptible,Infectious
0,9990,10
1,9986.683399,12.209777
2,9982.635620,14.906223
3,9977.696472,18.195717
4,9971.671162,22.207493
...
```

JSON output is `{ "time": number[], "series": { "<name>": number[] } }` with
every stock, flow and converter series (arrayed elements expanded to scalar
names such as `Pop[North,Old]`). Non-finite values become `null` because
`JSON.stringify` maps `NaN`/`Infinity` to `null`. Abridged real output:

```
$ sourcesink run tests/corpus/models/linear-reservoir-fill.xmile --json
{
  "time": [
    0, 1, 2, ... 10
  ],
  "series": {
    "Storage": [
      10, 12, 14, ... 30
    ],
    "Inflow": [
      2, 2, 2, ... 2
    ]
  }
}
```

Scenario example:

```bash verified
sourcesink run tests/corpus/models/scenario-population-growth.xmile --scenario high --columns Population
```

```
time,Population
0,100
1,120
...
10,619.173642
```

### `sweep`

Factorial grid over parameters. Each *unique combination* of parameter values
is one run.

```
sourcesink sweep <model> --param NAME=LO:HI:COUNT [--param a=1,2,4]...
              [--columns a,b] [--json]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--param` | `NAME=LO:HI:COUNT` or `NAME=a,b,c`, repeatable | required, ≥1 | `COUNT` is an integer ≥ 2; levels are evenly spaced and include both ends. `HI` must be ≥ `LO`. |
| `--columns` | comma list | series of the first successful run | Series whose **final** value is reported. |
| `--json` | switch | off | Print the ensemble object instead of CSV. |

Unknown element names are caught before sampling (`unknown element '…'`,
exit 2). A run that throws leaves a row with `NaN` finals and prints
`<n> of <m> runs failed: <message>` to stderr; the command still exits 0.

CSV layout: one row per run, the parameter columns in command-line order, then
`<series> final` for each selected column.

```bash verified
sourcesink sweep examples/environmental/streeter-phelps.xmile --param kd=0.2:0.4:3 --columns BOD,DO_deficit
```

```
kd,BOD final,DO_deficit final
0.200000,0.357193,0.178558
0.300000,0.046830,0.046742
0.400000,0.006060,0.011936
```

With `--json`, the shape is (abridged: `"..."` stands for more values):

```json
{
  "runs": [
    { "index": 0, "overrides": { "Growth_rate": 0.1 }, "seed": 0,
      "result": { "time": [0, 1, "..."], "series": { "Population": [100, 110, "..."] } } }
  ],
  "time": [0, 1, "..."]
}
```

A failed run carries `"error": "<message>"` and no `result`.

### `montecarlo`

Uncertainty ensemble over parameter ranges, summarised per time step.

```
sourcesink montecarlo <model> --param NAME=MIN:MAX [--param ...]...
              --runs N [--seed N] [--lhs] [--columns a,b]
              [--percentiles 5,50,95]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--param` | `NAME=MIN:MAX`, repeatable | required, ≥1 | Sampling range; requires `MIN < MAX`. |
| `--runs` | positive integer | required | Number of samples. |
| `--seed` | integer (may be negative) | `0` | Seed for the sampler and for every simulation in the ensemble. |
| `--lhs` | switch | off | Latin hypercube sampling instead of independent uniform samples. |
| `--columns` | comma list | series of the first successful run | Series to summarise. |
| `--percentiles` | comma list in 0..100 | `5,50,95` | Percentiles to add as columns. |

There is no `--json` flag for this command: `--json` is an unknown option and
exits 2.

CSV layout: `time`, then for each selected series `<name> mean,
<name> sd, <name> p5, <name> p50, <name> p95` (the `p` columns follow
`--percentiles` order). `sd` is the population standard deviation.

```bash verified
sourcesink montecarlo tests/corpus/models/scenario-population-growth.xmile --param Growth_rate=0.1:0.2 --runs 20 --seed 1 --lhs --columns Population --percentiles 5,50,95
```

```
time,Population mean,Population sd,Population p5,Population p50,Population p95
0,100,0,100,100,100
1,114.996212,2.850665,110.633988,114.946354,119.233143
2,132.322550,6.558137,122.398828,132.127710,142.165496
...
10,415.676255,102.260666,274.720544,402.818899,580.737524
```

### `convert`

Import a legacy `.stm`/`.itm` model file and write XMILE.

```
sourcesink convert <model.stm|model.itm> [out.xmile]
```

- No flags. The input must end in `.stm` or `.itm`; anything else is usage
  (exit 2).
- With `out.xmile`, writes the file; otherwise writes XMILE to stdout.
- Import warnings go to stderr as `import: <warning>`.
- A failed import exits 1.

No legacy files are committed to this repository, so there is no verified run
in this guide. The output of `convert` is exactly the text `writeXmile` emits:
`<xmile version="1.0">` with `header`, `sim_specs`, dimensions, variables,
scenarios and views.

### `explain`

Describe the model in words, list feedback loops, and report explanation
coverage.

```
sourcesink explain <model> [--loops] [--json]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--loops` | switch | off | Print only the Markdown loop list. |
| `--json` | switch | off | Print the full machine-readable report; wins if both flags are given. |

Human output is Markdown with sections Overview, Stocks, Flows, Converters and
graph functions, Feedback loops, Time settings. Underscores in element names are
shown as spaces. `--json` returns:

```json
{
  "markdown": "## Overview\n...",
  "loops": [
    {
      "id": "B1",
      "elements": ["infection", "Susceptible"],
      "type": "balancing",
      "links": [
        { "from": "infection", "to": "Susceptible", "kind": "flow-out-of-stock", "polarity": "-" },
        { "from": "Susceptible", "to": "infection", "kind": "information", "polarity": "+" }
      ]
    }
  ],
  "truncated": false,
  "coverage": { "missingElements": [], "missingLinks": [], "complete": true }
}
```

`loops` stops growing at the explainer's search limit; the JSON carries
`truncated: true` when the loop search was cut off. `coverage.complete` is
true when every element and connector appears in the prose.

```bash verified
sourcesink explain examples/ecology/sir-epidemic.xmile --loops
```

```
- **B1 — balancing:** infection → Susceptible → infection.
- **R1 — reinforcing:** infection → Infectious → infection.
- **B2 — balancing:** Infectious → recovery → Infectious.
```

### `fit`

Calibrate parameters to observations by simulation.

```
sourcesink fit <model> --data <observations.csv>
              --param NAME=MIN:MAX[:log] [--param ...]...
              [--rename "CSV header=element"]...
              [--method nelder-mead|de] [--starts N]
              [--objective sse|wsse|nse] [--seed N]
              [--json] [--write fitted.xmile]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--data` | path | required | Observations CSV. |
| `--param` | `NAME=MIN:MAX[:log]`, repeatable | required, ≥1 | Search bounds; `MIN < MAX`. `:log` requires `MIN > 0` and searches in log space. |
| `--rename` | `"CSV header=element"`, repeatable | none | Map a column header to a model element when automatic matching is not enough. |
| `--method` | enum | `nelder-mead` | `nelder-mead` (local, restarts with `--starts`), `de` or `differential-evolution` (global). |
| `--starts` | positive integer | `1` | Number of Nelder-Mead starts (the first is the initial guess, restarts come from a seeded Latin hypercube). |
| `--objective` | enum | `sse` | `sse` (raw sum of squares), `wsse` (each series divided by its observed variance), `nse` (sum of 1 − NSE). |
| `--seed` | integer | `0` | Deterministic seed for restarts, differential evolution and random functions in the model. |
| `--json` | switch | off | Print the `FitResult` JSON instead of the report. |
| `--write` | path | none | Write a copy of the model with the fitted constants as a full XMILE document; the confirmation goes to stderr. |

Observation CSV: the time column is the first column, unless a header matches
`time`, `t`, `date`, `day`/`days`, `year`/`years`, `month`/`months` or
`hour`/`hours`; each other column is a series.
Commas, semicolons or tabs separate fields; quoted fields are supported;
`NA`, `NaN`, `#N/A`, `-` and blank cells become missing values and are
dropped when comparing. A header with a trailing unit, e.g. `BOD (mg/L)` or
`flow [m3/s]`, is matched automatically to the element with the bare name
(`BOD`, `flow`). If an observed column names no model series after matching,
the command exits 2 with `observed series '…' is not in the model results`.
ISO dates in the time column are converted to days since the first date.

Human report: fitted value ± standard error per parameter (standard errors
come from a local linearisation at the optimum), objective, evaluation count,
convergence flag, per-series `points`, `RMSE`, `NSE`, `R²`, `bias`, and
identifiability warnings. `--json` returns the full `FitResult`:
`method`, `parameters`, `objective`, `evaluations`, `converged`,
`alignments`, `metrics`, `identifiability`, `history`.

```bash verified
sourcesink fit examples/environmental/streeter-phelps.xmile --data examples/environmental/streeter-phelps-observed.csv --param kd=0.05:1 --param ka=0.05:2
```

```
Fitted parameters:
  kd        = 0.3463 ± 0.0023
  ka        = 0.5508 ± 0.0051
Objective: 0.42142
Evaluations: 69
Converged: yes

Series metrics:
  series      points    RMSE     NSE      R²     bias
  BOD             17  0.0428  0.9999       1  0.01176
  DO_deficit      21  0.1363   0.996  0.9963  0.03354

Identifiability warnings:
  none
```

Write the fitted model and read the report as JSON:

```bash verified
sourcesink fit examples/environmental/streeter-phelps.xmile --data examples/environmental/streeter-phelps-observed.csv --param kd=0.05:1 --param ka=0.05:2 --write /tmp/sourcesink-fitted.xmile --json
```

### `sensitivity`

Rank parameters by their effect on one output metric.

```
sourcesink sensitivity <model> --param NAME=MIN:MAX[:log] [--param ...]...
              --metric SERIES:STAT[@TIME] [--method morris|sobol]
              [--trajectories N] [--samples N] [--seed N] [--json]
```

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `--param` | `NAME=MIN:MAX[:log]`, repeatable | required, ≥1 | Range per parameter; `:log` requires `MIN > 0`. |
| `--metric` | `SERIES:STAT[@TIME]` | required | `STAT` is `final`, `max`, `min`, `mean`, `integral`, or `at`. `at` requires `@TIME` (e.g. `DO_deficit:at@2`); no other statistic accepts `@TIME`. `mean` and `integral` use the trapezoid rule over the saved points. |
| `--method` | enum | `morris` | `morris` screening or `sobol` variance decomposition. |
| `--trajectories` | positive integer | `20` | Morris trajectories. Evaluations = `trajectories × (k + 1)`. |
| `--samples` | positive integer | `512` | Sobol base samples. Evaluations = `samples × (2k + 2)`. |
| `--seed` | integer | `0` | Seeded sampler and simulation seed. |
| `--json` | switch | off | Print the `MorrisResult` or `SobolResult` JSON. |

The command simulates one probe first: an unknown parameter or an unknown
metric series is a CLI error (exit 2) before the analysis starts. Failed
samples are counted in `failed` and leave the tables with fewer effective
points. Morris output ranks by `mu*` (largest first); Sobol output reports
first-order `S1` and total `ST` with 95 % bootstrap intervals.

```bash verified
sourcesink sensitivity examples/environmental/streeter-phelps.xmile --param kd=0.2:0.5 --param ka=0.4:0.8 --metric DO_deficit:max
```

```
Morris screening (metric DO_deficit:max)
Evaluations: 60, failed: 0

parameter         mu*          mu       sigma
kd             3.0825      3.0825     0.34249
ka             2.4125     -2.4125     0.33303
```

```bash verified
sourcesink sensitivity examples/environmental/streeter-phelps.xmile --param kd=0.2:0.5 --param ka=0.4:0.8 --metric DO_deficit:max --method sobol --samples 64
```

```
Sobol' indices (metric DO_deficit:max)
Evaluations: 256, failed: 0, variance: 1.354

parameter             S1 [95% CI]             ST [95% CI]
kd         0.58971 [-0.77176, 1.9321]  0.60931 [0.47253, 0.7729]
ka          0.5972 [-0.42471, 1.7161]  0.33882 [0.24711, 0.44711]
```

JSON shapes: Morris is
`{ metric, parameters: [{name,mu,muStar,sigma}], evaluations, failed }`;
Sobol is
`{ metric, parameters: [{name,first,firstCI,total,totalCI}], evaluations, failed, variance }`.

### `units`

Check declared units against inferred equation units.

```
sourcesink units <model> [--json]
```

- Human output is `No unit problems found.` or one `element: message` line
  per finding. Findings never change the exit code: the command exits 0.
- `--json` prints an array of
  `{ element, message, expected?, actual? }`.
- A missing or unreadable model exits 1.

Units are advisory. `checkUnits` infers the unit of every equation and checks:
a flow's units against `stock-units / time-unit`, declared vs inferred units,
and additions/comparisons with inconsistent operands. Blank units mean
"unknown", not zero, and are not reported.

```bash verified
sourcesink units examples/environmental/streeter-phelps.xmile
```

```
No unit problems found.
```

A broken variant (reaeration declared per year in a per-day model) prints
findings such as:

```
reaeration: reaeration is in mg/L/year, but its equation gives mg/day/L; the values differ by a factor of 365.25
```

## 5. Writing a model file

SourceSink's canonical format is XMILE. The reader accepts a small, forgiving
subset; the writer emits standard XMILE plus the `ss:` extension namespace
`https://sourcesink.dev/xmile/1`.

### 5.1 Minimal complete model

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xmile version="1.0">
  <header>
    <name>Logistic Growth</name>
    <vendor>SourceSink</vendor>
    <product version="0.1.0">SourceSink</product>
  </header>
  <sim_specs method="Euler" time_units="Year">
    <start>0</start>
    <stop>20</stop>
    <dt>0.125</dt>
    <saveper>1</saveper>
  </sim_specs>
  <model>
    <variables>
      <stock name="Population">
        <eqn>10</eqn>
        <units>individuals</units>
        <inflow name="growth"/>
      </stock>
      <flow name="growth">
        <eqn>r * Population * (1 - Population / K)</eqn>
        <units>individuals/Year</units>
      </flow>
      <aux name="K">
        <eqn>1000</eqn>
        <units>individuals</units>
      </aux>
      <aux name="r">
        <eqn>0.2</eqn>
        <units>1/Year</units>
      </aux>
    </variables>
  </model>
</xmile>
```

Everything outside `<variables>` is optional. Missing `sim_specs` values fall
back to start 0, stop 12, dt 0.25, saveEvery 1, Euler. The save
interval may be written `<saveper>` or `<saveEvery>`. The root
`<xmile>` node may omit its attributes. `<header><name>` defaults to
`Untitled`.

`<doc>` on any element is documentation. `<units>` is a free-form unit
string (Section 5.4). `<ss:provenance author="ai" agent="…"/>` records where
an element came from; `author` must be `human`, `ai` or `import`.

### 5.2 Names and references

- A name may contain letters, digits, underscores and single spaces. Equations
  refer to elements by name. Surround a name with double quotes
  (`"savings account"`) when it would otherwise be split or could be confused
  with a keyword.
- Do not use the reserved words `IF`, `THEN`, `ELSE`, `AND`, `OR`, `NOT` as
  names, and do not start a name with a digit.
- Matching for parameters, scenarios, connectors and column selection is
  case-insensitive with spaces ≡ underscores. Names that differ only in case
  or underscores therefore resolve to the same element: avoid them. The CLI's
  structural validation rejects only exactly identical names, but the patch
  protocol (`add`/`rename`) rejects canonical duplicates.
- A connector's `from`/`to` are names. Flow wiring may use flow names or ids;
  writing XMILE emits flow names.

### 5.3 Wiring, connectors and views

A stock declares which flows fill and drain it:

```xml
<stock name="Population">
  <eqn>10</eqn>
  <inflow name="births"/>
  <outflow name="deaths"/>
</stock>
```

The reader also accepts `<outflow>deaths</outflow>`, `<inflow name="births"/>`,
and the grouped forms `<inflows><flow>births</flow></inflows>` /
`<outflows><flow>deaths</flow></outflows>`. A flow listed as an inflow by two
stocks, or as any inflow/outflow of an unknown flow, is a structural error.
An unattached end is a cloud and is simply omitted.

Optional markers: `<queue/>` (FIFO), `<conveyor><len>3</len></conveyor>`
(material transit delay), `<oven><capacity>10</capacity><fill_time>2</fill_time></oven>`,
`<leak/>` on a conveyor leakage flow, and `non_negative="true"` on a stock or
flow.

Connectors live in a view:

```xml
<views>
  <view type="stock_flow">
    <connector from="K" to="growth"/>
    <connector from="Population" to="growth"/>
    <stock name="Population" x="120" y="80"/>
    <flow name="growth" x="160" y="80"/>
  </view>
</views>
```

Connectors are informational links only. Positions are optional; without
them the app auto-lays out the diagram. A connector into a stock is invalid.
The writer only emits `<views>` when there are positions or connectors.

### 5.4 Units strings

Units are optional and advisory. Accepted spellings look like `people`,
`mg/L`, `mg/L/day`, `1/day`, `m3/s`, `kg*m/s^2`, `%`, `dimensionless`.
The checker recognizes a fixed vocabulary and treats any other word as its own
base symbol (so `fish`, `dollars` and `tonnes` work). Recognized time units
compare with conversion factors: `s`, `min`, `h`/`hr`/`hour`, `d`/`day`,
`wk`/`week`, `mo`/`month`, `yr`/`year`. Recognized mass: `mg`, `g`, `kg`,
`tonne`/`t`. Length: `mm`, `cm`, `m`, `km`; volume: `L`/`liter`/`litre`,
`mL`, and `m3`. `%` is dimensionless at scale 0.01. Unknown trailing plural
`s` is stripped for matching (`tonnes` ≡ `tonne`), but `person` and `people`
stay distinct.

### 5.5 Graphical functions

```xml
<gf name="death_fraction" interpolation="linear" extrapolation="clip">
  <units>1/year</units>
  <doc>Per-capita death rate as a function of forage per deer.</doc>
  <xpts>0, 1, 2, 4, 10</xpts>
  <ypts>1.2, 1.0, 0.8, 0.5, 0.1</ypts>
</gf>
```

Call a graphical function in an equation by name as a one-argument function,
e.g. `death_fraction(Forage / Deer)`. `interpolation` is `linear` (default),
`held` (step, also accepted as `step`) or `discrete`; `extrapolation` is
`clip` (default) or `extend`. Points are expected in increasing x order (the
engine interpolates them in the order given). A graphical
function cannot be a parameter override.

### 5.6 Arrays (subscripts)

Declare dimensions at the root (or inside `<model>`) and attach them to an
element with `<dimensions>`:

```xml
<dimensions>
  <dim name="Region"><elem name="North"/><elem name="South"/></dim>
  <dim name="Age"><elem name="Young"/><elem name="Old"/></dim>
</dimensions>
...
<stock name="Pop">
  <dimensions><dim name="Region"/><dim name="Age"/></dimensions>
  <eqn>100</eqn>
  <element subscript="North, Old"><eqn>50</eqn></element>
  <inflow name="Births"/>
</stock>
```

The element equation is "apply to all"; `<element subscript="Label,...">`
overrides one cell. In equations, a dimension name used as a subscript stands
for the current cell (`births[Region] = Pop[Region] * r`). `*` means "all
labels along this dimension" (`SUM(Pop[Region, *])`). Refer to one cell with
all labels in dimension order, e.g. `Pop[North,Old]`. Simulation expands an
arrayed model into scalar series; the CLI reports names like
`Pop[North,Old]`.

### 5.7 Scenarios

```xml
<xmile version="1.0" xmlns:ss="https://sourcesink.dev/xmile/1">
...
    <ss:scenarios>
      <ss:scenario id="high" name="High growth">
        <ss:override name="Growth_rate">0.2</ss:override>
        <ss:doc>Faster adoption than the base case.</ss:doc>
      </ss:scenario>
    </ss:scenarios>
```

Overrides set a stock's initial value or a flow/converter equation (a numeric
string becomes a number). Optional `<ss:run start="0" stop="20" dt="0.1"
saveper="1" method="RK4" time_units="Year"/>` changes the run for that
scenario. Select it with `run --scenario <id|name>`. Scenarios are also
listable through the IR but the CLI only applies them to `run`.

### 5.8 Equation dialect

Numbers, names, parentheses, function calls, and these operators:

| Syntax | Meaning |
| --- | --- |
| `+ - * /` | arithmetic |
| `^` | power (`a^b`, right associative) |
| `-x`, `+x` | unary sign |
| `< <= > >=` | comparisons, yielding 1 or 0 |
| `= == <> !=` | equality/inequality, yielding 1 or 0 |
| `AND`, `OR`, `NOT` | logical operators on truthy numbers |

Precedence, low to high: `OR`, `AND`, `NOT`, comparisons, `+ -`, `* /`,
unary sign, `^`, primary. There is no implicit multiplication: write `2 * x`.

Conditionals have two accepted forms:

```
IF(condition, valueIfTrue, valueIfFalse)
IF condition THEN valueIfTrue ELSE valueIfFalse
```

`TIME`, `DT`, `STARTTIME`, `STOPTIME`, `INITIAL_TIME`, `FINAL_TIME` and `PI`
are always available. Function names are case-insensitive. Unknown names and
unknown functions are structural errors (the gauntlet's structure stage); the
`run` command does not run that stage, so a bad reference fails at simulation
time with `unresolved identifier '…'` and exit 1.

### 5.9 Built-in functions

Complete catalog from `src/model/src/functions.ts`. "Stateful" functions keep
storage across time steps (delays, smooths, random streams, oven/queue
introspection); they may be used like any other call.

| Function | Arguments | Kind | Meaning |
| --- | --- | --- | --- |
| `ABS` | 1 | pure | absolute value |
| `EXP` | 1 | pure | e^x |
| `LN` | 1 | pure | natural log (alias `LOGN`) |
| `LOGN` | 1 | pure | natural log |
| `LOG10` | 1 | pure | base-10 log |
| `SQRT` | 1 | pure | square root |
| `SIN` | 1 | pure | sine (radians) |
| `COS` | 1 | pure | cosine (radians) |
| `TAN` | 1 | pure | tangent (radians) |
| `ARCTAN` | 1 | pure | arctangent (radians) |
| `MIN` | 2+ | pure | minimum |
| `MAX` | 2+ | pure | maximum |
| `MOD` | 2 | pure | modulo (a % b) |
| `INT` | 1 | pure | largest integer <= x (`INT(-8.9) = -9`); alias `INTEGER` |
| `INTEGER` | 1 | pure | largest integer <= x |
| `ROUND` | 1 | pure | round to nearest integer |
| `POWER` | 2 | pure | a^b |
| `MEAN` | 1+ | pure | arithmetic mean of args |
| `STDDEV` | 1+ | pure | population stddev of args |
| `SUM` | 1+ | pure | sum of args |
| `PCT` | 1 | pure | fraction as a percentage (x * 100) |
| `SWITCH` | 2 | pure | `SWITCH(a, b)`: 1 if a > b, else 0 |
| `SOUND` | 1 | pure | `SOUND(x)`: 1 while x > 0 (no audio headless) |
| `CGROWTH` | 1 | pure | `CGROWTH(percentage)`: DT-independent compound growth rate per time unit |
| `SINWAVE` | 2 | pure | `SINWAVE(amplitude, period)`: sine from the start time |
| `COSWAVE` | 2 | pure | `COSWAVE(amplitude, period)`: cosine from the start time |
| `PV` | 4 | pure | `PV(rate, nper, pmt, fv)`: present value (cash received > 0) |
| `FV` | 4 | pure | `FV(rate, nper, pmt, pv)`: future value (cash received > 0) |
| `PMT` | 4 | pure | `PMT(rate, nper, pv, fv)`: periodic payment (cash received > 0) |
| `COUNTER` | 2 | pure | `COUNTER(start, end)`: starts at `start`, rises one per time unit, wraps at `end` |
| `REWORK` | 1 | pure | `REWORK(percentage)`: leak fraction so repeated rework totals `percentage`% of the work |
| `IF` | 3 | pure | `IF(cond, a, b)` conditional |
| `THEN` | 0 | token | syntactic keyword, not callable |
| `ELSE` | 0 | token | syntactic keyword, not callable |
| `AND` | 0 | token | logical operator |
| `OR` | 0 | token | logical operator |
| `NOT` | 1 | pure | logical negation |
| `STEP` | 2 | pure | `STEP(height, time)`: 0 before `time`, `height` from `time` onward |
| `PULSE` | 1–3 | pure | `PULSE(volume, first?, interval?)`: moves `volume` in one DT (value volume/DT); `first` defaults to the start time; no/0 interval means one pulse |
| `RAMP` | 1–3 | pure | `RAMP(slope, start?, end?)`: 0 until `start` (default: start time), then rising at `slope`; held after `end` |
| `DELAY1` | 2–3 | stateful | first-order material delay; `DELAY1(input, delay, init?)` |
| `DELAY3` | 2–3 | stateful | third-order material delay (three stages of `delay/3`) |
| `DELAYN` | 3–4 | stateful | `DELAYN(input, delay, init, order)` |
| `SMTH1` | 2–3 | stateful | `SMTH1(input, averagingTime, initial?)`: first-order exponential smooth |
| `SMTH3` | 2–3 | stateful | `SMTH3(input, averagingTime, initial?)`: three cascaded smooths of `averagingTime/3` |
| `TREND` | 2–3 | stateful | `TREND(input, averagingTime, initial?)`: fractional change per unit time |
| `RANDOM` | 2–3 | stateful | `RANDOM(min, max, seed?)`: uniform in `[min, max]` |
| `NORMAL` | 2–3 | stateful | `NORMAL(mean, stddev, seed?)`: gaussian |
| `SMTHN` | 3–4 | stateful | `SMTHN(input, averagingTime, n, initial?)`: n cascaded smooths of `averagingTime/n` |
| `FORCST` | 3–4 | stateful | `FORCST(input, averagingTime, horizon, initial?)`: trend extrapolation |
| `DERIVN` | 2 | stateful | `DERIVN(input, order)`: nth derivative by backward differences (0 at start) |
| `NPV` | 2–3 | stateful | `NPV(input, rate, initial?)`: present value at the start time of the stream so far |
| `ENDVAL` | 1–2 | stateful | `ENDVAL(input, initial?)`: ending value of the previous run (single run: the initial value) |
| `EXPRND` | 1–2 | stateful | `EXPRND(mean, seed?)`: exponentially distributed random number |
| `MONTECARLO` | 1–2 | stateful | `MONTECARLO(probability, seed?)`: 1 with `probability`% per time unit, else 0 |
| `TRANSTIME` | 1 | stateful | `TRANSTIME(conveyor)`: transit time of the most recently entering material |
| `QLEN` | 1 | stateful | `QLEN(queue or conveyor)`: number of batches held |
| `QELEM` | 2 | stateful | `QELEM(queue or conveyor, n)`: amount in element n, counting from the next to leave |
| `CAP` | 1 | stateful | `CAP(oven or conveyor)`: capacity |
| `COOKTIME` | 1 | stateful | `COOKTIME(oven)`: cook time of the current batch, else 0 |
| `OSTATE` | 1 | stateful | `OSTATE(oven)`: 0 filling, 1 cooking, 2 emptying |
| `CTMEAN` | 1–3 | stateful | `CTMEAN(flow, initial?, weighted?)`: average cycle time so far |
| `CTMIN` | 1–3 | stateful | `CTMIN(flow, initial?, instantaneous?)`: shortest cycle time |
| `CTMAX` | 1–3 | stateful | `CTMAX(flow, initial?, instantaneous?)`: longest cycle time |
| `CTSTDDEV` | 1–3 | stateful | `CTSTDDEV(flow, weighted?, initial?)`: spread of cycle times |
| `CTFLOW` | 1–2 | stateful | `CTFLOW(flow, initial?)`: time-stamped volume in the flow |
| `THROUGHPUT` | 1–2 | stateful | `THROUGHPUT(flow, initial?)`: average time-stamped flow rate since the first batch |
| `CYCLETIME` | 1 | stateful | `CYCLETIME(outflow)`: time material leaving through `outflow` spent in its conveyor/queue |
| `DELAY` | 2–3 | stateful | `DELAY(input, delay, initial?)`: pipeline delay (input `delay` time units ago) |
| `POISSON` | 1–2 | stateful | `POISSON(mu, seed?)`: Poisson count this DT for mean `mu` per unit time |
| `PREVIOUS` | 1 | stateful | value of the argument one DT step ago |
| `INIT` | 1 | stateful | value of the argument at the start of the simulation |

Clock variables: `TIME`, `DT`, `STARTTIME`, `STOPTIME`, `INITIAL_TIME`,
`FINAL_TIME`. Constant: `PI`.

### 5.10 Examples to copy

Every file under `examples/` is a tested XMILE model. Start from
`examples/environmental/streeter-phelps.xmile` (two stocks sharing a flow,
converters, connectors, units) or `examples/ecology/sir-epidemic.xmile`
(three stocks, feedback loops). `examples/resources/kaibab-deer.xmile` has a
graphical function; `tests/corpus/models/age-region-population.xmile` has two
dimensions and per-cell equations; `tests/corpus/models/scenario-population-growth.xmile`
has a scenario. Never copy the proprietary models referenced in
`docs/format/stm.md`.

## 6. The MCP server

The server speaks MCP over stdio (one JSON-RPC message stream on stdin/stdout)
and keeps models in memory. It reads files only through `model.open` and never
writes files; use `model.export` to obtain XMILE or IR JSON.

Start it:

```bash
npm start -w @sourcesink/mcp
# or directly
npx tsx src/mcp/src/server.ts
# installed bin
sourcesink-mcp
```

A client configuration is a stdio server whose command runs one of those.
Each tool result is a single text content block containing JSON (or XMILE/JSON
text for `model.export`). A failed tool sets `isError: true` and returns
`{"error":{"code":"…","message":"…"}}`. Error codes: `not_found`,
`invalid_input`, `io`, `parse`, `simulation`, `internal`. Nothing throws
across the protocol.

Model ids are `m1`, `m2`, … per server process, starting at 1. Every model
starts at version 1; each successful non-dry-run patch increments it.

### 6.1 Tools

All tools take a JSON object. Argument names and defaults:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `model.create` | `name?` (non-empty, trimmed), `description?`, `xmile?` — provide exactly one of `name` or `xmile` | `{ id, version }`. With `xmile`, parse errors return code `parse`. |
| `model.open` | `path` (`.xmile`, `.stm` or `.itm`) | `{ id, version, warnings }`. Import warnings are strings. |
| `model.get` | `id` | The model as IR JSON (a deep copy). |
| `model.patch` | `id`, `patch` (a `ModelPatch`, Section 6.3), `dryRun?` | `{ ok, findings, diff, version }`. Applies only when `ok` is true and `dryRun` is not true. `diff` is Markdown (possibly `""` when apply failed). Default provenance is `{ author: "ai" }`. |
| `model.validate` | `id` | `{ errors, warnings }` — findings of the schema/apply/parse/structure/units/smoke gauntlet with no ops. |
| `model.simulate` | `id`, `run?` (`start`, `stop`, `dt`, `saveEvery`, `integration`, `timeUnits`, `dtUnits`), `seed?` (default 0), `series?`, `every?` (positive integer, default 1) | `{ time, series }`. Default series: all stocks (arrayed models expanded). An arrayed base name selects all its elements. `every` thins rows by taking every nth. |
| `model.ensemble` | `id`, one of `samples?` (`[{NAME: value}]`), `grid?` (`{NAME: [values]}`), `ranges?` (`{NAME: [min, max]}`) — at most one; `n?` (required with `ranges`), `lhs?`, `seed?` (default 0), `series?` | `{ time, summary, failed }` where `summary[name] = { mean, min, max, sd, percentiles }` and every stat is an array over time. With no design, runs the base model once. One seed per run: `seed + runIndex`. |
| `model.calibrate` | `id`, `data` (either `{ csv }` or `{ time, series }`), `params` (`[{name,min,max,initial?,scale?}]`, min 1, `max >= min`), `options?` (`method`, `objective`, `starts`, `maxEvaluations`, `tolerance`, `seed`), `apply?` | `FitResult`; with `apply` and convergence also `applied: true`, `version`, `findings`. If not converged: `applied: false`. The applied fitted constants go through the normal patch gauntlet. |
| `model.sensitivity` | `id`, `params` (same shape), `metric` (`{series, stat}`, where `stat` is `final`, `max`, `min`, `mean`, `integral`; or `{series, stat:"at", time}`), `method?` (`morris` default, `sobol`), `samples?`, `trajectories?`, `seed?` | `MorrisResult` or `SobolResult` JSON. An unknown parameter or metric series is code `invalid_input`. |
| `model.explain` | `id` | `{ markdown, loops, truncated, coverage }`. |
| `model.export` | `id`, `format` (`xmile` or `json`) | The XMILE text or pretty-printed IR JSON, as text. |
| `model.history` | `id` | `[{ version, rationale?, provenance, patch, diff, appliedAt }]`, oldest first. Only accepted, applied patches are recorded. |

Example session (tool call arguments and the JSON text each returns):

```json
{"name":"model.create","arguments":{"name":"Tank test"}}
→ {"id":"m1","version":1}

{"name":"model.patch","arguments":{"id":"m1","patch":{"ops":[
  {"op":"add","kind":"stock","element":{"name":"Tank","equation":"10","units":"L","outflows":[]}},
  {"op":"add","kind":"flow","element":{"name":"drain","equation":"0.1 * Tank","units":"L/day"}},
  {"op":"add","kind":"converter","element":{"name":"k","equation":"0.1","units":"1/day"}},
  {"op":"wire","flow":"drain","from":"Tank","to":null},
  {"op":"connect","from":"k","to":"drain"},
  {"op":"update","name":"drain","changes":{"equation":"k * Tank"}},
  {"op":"setRun","run":{"start":0,"stop":10,"dt":0.25,"saveEvery":1,"timeUnits":"day"}}
],"rationale":"a draining tank"}}}
→ {"ok":true,"findings":[],"diff":"…","version":2}

{"name":"model.simulate","arguments":{"id":"m1","series":["Tank"],"every":2}}
→ {"time":[0,2,4,6,8,10],"series":{"Tank":[10,8.16651803662262,6.669201684248257,5.446415584428735,4.44782511051798,3.632324398878807]}}

{"name":"model.explain","arguments":{"id":"m1"}}
→ {"markdown":"## Overview…","loops":[],"truncated":false,"coverage":{…}}
```

(The `diff` and `markdown` strings above are elided; the `model.simulate`
numbers are the actual result of that patch.)

### 6.2 Resources

| URI | Contents |
| --- | --- |
| `sourcesink://models` | JSON list of `{ id, name, version }` for every stored model. |
| `sourcesink://models/{id}` | One model as IR JSON. An unknown id makes the resource read fail. |

### 6.3 Patch format

A patch is `{ ops: PatchOp[], provenance?: Provenance, rationale?: string }`.
`provenance` is stamped on every element the patch adds or changes; when
omitted the server uses `{ author: "ai" }`. `rationale` is free text and is
kept in history. A patch is atomic: operations apply in order to a copy, and
a failing op leaves the stored model untouched.

| Op | Shape | Example |
| --- | --- | --- |
| `add` | `{op:"add", kind:"stock"\|"flow"\|"converter"\|"graphFunction", element:{name, …}}` | `{"op":"add","kind":"stock","element":{"name":"Tank","equation":"10","units":"L"}}` |
| `update` | `{op:"update", name, changes:{…}}` | `{"op":"update","name":"drain","changes":{"equation":"k * Tank","units":"L/day"}}` |
| `rename` | `{op:"rename", name, to}` | `{"op":"rename","name":"Tank","to":"Storage"}` — rewrites references, wiring, connectors, layout, array spec and scenario overrides. |
| `remove` | `{op:"remove", name}` | `{"op":"remove","name":"drain"}` — also removes connectors touching it and drops its stock wiring. |
| `connect` | `{op:"connect", from, to}` | `{"op":"connect","from":"k","to":"drain"}` — informational link; targets may not be stocks; self-links and duplicate links are errors. |
| `disconnect` | `{op:"disconnect", from, to}` | `{"op":"disconnect","from":"k","to":"drain"}` — missing link is an error. |
| `wire` | `{op:"wire", flow, from?, to?}` | `{"op":"wire","flow":"drain","from":"Tank","to":null}` — `null` (or an omitted key, which keeps the current end) means a cloud. `from`/`to` are stock names or null/omit; a flow cannot run from a stock back into itself. |
| `setRun` | `{op:"setRun", run:{…}}` | `{"op":"setRun","run":{"stop":20,"dt":0.125,"integration":"rk4"}}` — any subset of `start`, `stop`, `dt`, `saveEvery`, `integration`, `timeUnits`, `dtUnits`. |
| `setLayout` | `{op:"setLayout", name, x, y}` | `{"op":"setLayout","name":"Tank","x":120,"y":80}` — finite numbers, diagram units. |

`add` element fields: common `name` (required), `documentation`, `units`,
`provenance`, `annotations`, optional `id`; stock adds `equation`, `inflows`,
`outflows`, `nonNegative`, `conveyor`, `queue`, `oven`; flow adds `equation`,
`biflow`, `nonNegative`, `leak`; converter adds `equation`; graphFunction adds
`points`, `interpolation`, `extrapolation`. Defaults on add: stock `equation
"0"`, empty wiring; flow/converter `equation "0"`; graph function empty
points, `linear`, `clip`. Unknown fields are schema errors. `update` accepts
the same fields except `kind`, `id` and `name` (use `rename`).

### 6.4 Validation gauntlet

`model.patch` and `model.validate` run the same stages. The first stage with
an error stops the pipeline; later stages may not run. Findings carry
`stage`, `severity` (`error`/`warning`), optional `element`, and `message`.

| Stage | Catches |
| --- | --- |
| `schema` | Unknown op, unknown or mistyped field, wrong enum value, malformed provenance, unknown keys. |
| `apply` | Unknown or duplicate element names, bad kind, an op that cannot apply (unknown flow for `wire`, missing connector for `disconnect`, duplicate connector, connector into a stock, self-connection, flow from a stock back into itself). |
| `parse` | Equations the parser cannot read. |
| `structure` | IR `validate` failures (duplicate names, bad run spec, connector targets), wiring errors (unknown/duplicate flow ends), unknown references and unknown functions (built-ins plus graphical functions are allowed), connectors into stocks. |
| `units` | Dimensional mismatches. Always `warning`, never fatal. |
| `smoke` | A run capped at `min(run length, 10 × dt)` that throws, returns no samples, or produces a non-finite value. |

`ok` is true when no finding is an error. For a failed patch, `diff` is `""`
when apply failed, otherwise the review diff of the candidate model.

## 7. Recipes

Each block below is executed by `tests/llm-guide.test.ts` (the `verified`
tag). Paths are relative to the repository root.

### 7.1 Build a model from scratch and check it

Write the minimal logistic model, check units, and run it. The `cat` writes a
scratch file in `/tmp`; in real work, save the model wherever you like.

```bash verified
cat > /tmp/sourcesink-logistic.xmile <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<xmile version="1.0">
  <header><name>Logistic Growth</name></header>
  <sim_specs method="Euler" time_units="Year">
    <start>0</start><stop>20</stop><dt>0.125</dt><saveper>1</saveper>
  </sim_specs>
  <model><variables>
    <stock name="Population">
      <eqn>10</eqn><units>individuals</units><inflow name="growth"/>
    </stock>
    <flow name="growth">
      <eqn>r * Population * (1 - Population / K)</eqn><units>individuals/Year</units>
    </flow>
    <aux name="K"><eqn>1000</eqn><units>individuals</units></aux>
    <aux name="r"><eqn>0.2</eqn><units>1/Year</units></aux>
  </variables></model>
</xmile>
EOF
sourcesink units /tmp/sourcesink-logistic.xmile
sourcesink run /tmp/sourcesink-logistic.xmile --columns Population
```

### 7.2 Explain a model

```bash verified
sourcesink explain examples/environmental/streeter-phelps.xmile --loops
```

Use the Markdown from `sourcesink explain <model>` (without `--loops`) when a
person asks what a model says; quote the loop list rather than inventing
loops.

### 7.3 Parameter sweep

```bash verified
sourcesink sweep examples/environmental/streeter-phelps.xmile --param kd=0.2:0.4:3 --param ka=0.5:0.7:2 --columns DO_deficit
```

Read the `DO_deficit final` column, or use `--json` and inspect
`runs[i].result.series`.

### 7.4 Monte Carlo uncertainty bands

```bash verified
sourcesink montecarlo examples/environmental/streeter-phelps.xmile --param kd=0.2:0.4 --param ka=0.4:0.8 --runs 20 --seed 1 --lhs --columns DO_deficit --percentiles 5,50,95
```

The p5 and p95 columns bound the 90 % band; p50 is the median. Use more runs
(e.g. 500) for reporting and keep `--seed` to reproduce.

### 7.5 Morris screening, then Sobol attribution

```bash verified
sourcesink sensitivity examples/environmental/streeter-phelps.xmile --param kd=0.2:0.5 --param ka=0.4:0.8 --metric DO_deficit:max --method morris --trajectories 10
```

```bash verified
sourcesink sensitivity examples/environmental/streeter-phelps.xmile --param kd=0.2:0.5 --param ka=0.4:0.8 --metric DO_deficit:max --method sobol --samples 32
```

Morris is cheap: use it to drop parameters with `mu*` near zero. Then run
Sobol on the survivors; `ST` much larger than `S1` indicates interaction.

### 7.6 Fit to observations and write the fitted model

The observation file has unit-suffixed headers (`BOD (mg/L)`,
`DO deficit (mg/L)`), matched automatically.

```bash verified
sourcesink fit examples/environmental/streeter-phelps.xmile --data examples/environmental/streeter-phelps-observed.csv --param kd=0.05:1 --param ka=0.05:2 --write /tmp/sourcesink-fitted.xmile
```

`/tmp/sourcesink-fitted.xmile` is a complete XMILE model with `kd` and `ka`
replaced by constants. Re-run `units` and `run` on it after editing. If a
column does not match, pass `--rename "Observed DO (mg/L)=DO_deficit"`.

### 7.7 Convert a legacy file

No legacy `.stm`/`.itm` file is committed to this repository, so this recipe
is descriptive:

```bash
sourcesink convert path/to/model.stm model.xmile
# without an output path, XMILE goes to stdout:
sourcesink convert path/to/model.stm > model.xmile
```

Watch stderr for `import: …` warnings (for example inferred oven settings).
The result is ordinary XMILE: open it, run `sourcesink units model.xmile`,
then `sourcesink run model.xmile`. If `convert` exits 2, the extension is not
`.stm`/`.itm`; if it exits 1, the import failed.

## 8. Pitfalls and checks before answering

Run these checks in this order when you build or open a model:

1. **Units.** `sourcesink units model.xmile`. A clean model prints `No unit
   problems found.` Findings are warnings and exit 0, so read stdout. Common
   findings name the expected unit and a conversion factor (for example a
   per-year rate in a per-day model).
2. **Run.** `sourcesink run model.xmile --columns <the series you care about>`.
   Then inspect the output for `NaN` (unknown column, undefined math) or
   `Infinity` (division by zero / blow-up). Both exit 0. In `--json` output
   they appear as `null`.
3. **Structure.** The CLI `run` runs the IR's `validate` (exact duplicate
   names, bad run settings, unknown connector targets, a connector into a
   stock) but **not** the MCP gauntlet's full structure stage. Unknown equation
   references only fail during simulation (`unresolved identifier '…'`,
   exit 1), and flow-wiring ownership is unchecked. If you can, use the MCP
   `model.validate`/`model.patch` (it runs structure and smoke stages) before
   trusting an edited model.
4. **Time settings.** `saveEvery` sets output rows; `dt` sets integration.
   Rows are every `saveEvery` from `start`, plus the final `stop` even when it
   is not a multiple. Make `dt` small relative to the fastest rate (a common
   rule is `dt <= saveEvery/4`; halve it if an Euler run oscillates or goes
   negative). `saveEvery` does not have to equal `dt`.
5. **Stiff or fast dynamics.** Prefer `--method rk4` or `rk45`. `rk45` takes
   adaptive sub-steps inside each `dt`; Euler can overshoot and diverge.
6. **Names.** `DO deficit`, `DO_deficit` and `do_deficit` are one element.
   Array cells need every label in order: `Pop[North,Old]`, not `Pop[Old]`.
   Quote `--columns` values that contain commas, e.g.
   `--columns "Pop[North,Old]"`. A misspelled column in `run` is silent
   (all `NaN`); `sensitivity` catches an unknown metric series (exit 2) and
   `sweep`/`montecarlo` catch unknown parameter names (exit 2).
7. **CSV reading.** The first header is always `time`; other headers are
   series names. Integers print bare, other values with six decimals. In
   `sweep`, each row has the parameter values then `<series> final`; a failed
   run still gets a row with `NaN`. In `montecarlo`, the columns are `mean`,
   `sd`, then the requested percentiles. Do not parse the human reports
   (`fit`, `sensitivity`, `explain`) as data; use `--json` (except Monte
   Carlo, which has no JSON form).
8. **Calibration sanity.** Check `Converged`, the standard errors and the
   identifiability warnings. A huge standard error means the data cannot
   identify that parameter. `:log` requires positive bounds. Use `--starts 5`
   or `--method de` if a fit looks stuck, and check `RMSE`/`NSE` per series.
9. **Sensitivity cost.** Morris evaluates `trajectories × (k + 1)` simulations;
   Sobol evaluates `samples × (2k + 2)` and supports at most 10 parameters in
   one run (the Sobol' sequence is limited to 21 dimensions, and the design
   uses `2k`). Start small, then raise `--samples` for final numbers.
10. **Never write model files by hand when a patch will do.** Through MCP, all
    edits should be `model.patch` ops so they are schema-checked, structure-
    checked, unit-warned, smoke-run and diffed. Read `model.get` first, use
    exact names from it, and send `dryRun: true` if you want a diff without
    changing the model.

## 9. Where to read more

- `README.md` — product overview and install.
- `docs/analysis.md` — calibration, identifiability, sensitivity, uncertainty
  in depth.
- `docs/assistant.md` — how the conversational assistant uses patches.
- `examples/README.md` — the example library with sources and expected
  behavior.
- `docs/format/stm.md` — the legacy binary format spec (the importer's
  contract).
- `src/cli/src/run.ts`, `src/cli/src/args.ts`, `src/cli/src/fit.ts`,
  `src/cli/src/sensitivity.ts` — the authoritative CLI behavior.
- `src/mcp/src/tools.ts`, `src/mcp/src/schemas.ts`, `src/patch/src/types.ts`,
  `src/patch/src/gauntlet.ts` — the authoritative MCP and patch behavior.
- `src/model/src/functions.ts` — the built-in catalog.
- `src/xmile/src/index.ts` — the XMILE reader/writer.
