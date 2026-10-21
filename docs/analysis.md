# Calibration, sensitivity and uncertainty

This guide explains how SourceSink helps you answer three different questions
about a model:

| Question | Tool | Typical output |
| --- | --- | --- |
| What parameter values make the model agree with observations? | **calibration** (`calibrate`) | best-fit values, standard errors, fit metrics |
| Can the data actually distinguish those parameters? | **identifiability** (part of `calibrate`) | standard errors, correlation matrix, warnings |
| Which uncertain inputs drive the uncertainty in an output? | **sensitivity** (`morris`, `sobol`) | ranked parameters, variance shares |
| How wide is the output band under input uncertainty? | **uncertainty / Monte Carlo** (`simulateEnsemble`, `summarize`) | mean, standard deviation, percentiles over time |

All of these are built on the same rule: the model is plain data and the
simulation engine is a pure function. The analysis layer never re-implements
the model; it copies the model, replaces parameter equations with candidate
values (`applyOverrides`), calls `simulate`, and reduces the resulting time
series to numbers.

The examples below run from the repository root and use the environmental
example models in `examples/environmental/`.

---

## 1. Vocabulary

### Model parameters

A `ParameterSpec` names an element and gives the range to search or sample:

```ts
interface ParameterSpec {
  name: string;          // stock, flow or converter name
  min: number;
  max: number;
  initial?: number;      // starting guess for local optimisers
  scale?: "linear" | "log";
}
```

For a stock, "setting" the parameter means replacing its **initial value**;
for a flow or converter it means replacing the **equation** with a constant.
Names match case-insensitively with spaces and underscores normalised
(`canonicalName`), so `DO deficit`, `do_deficit` and `DO_deficit` refer to the
same element.

Use `scale: "log"` for positive parameters that vary over orders of magnitude
(decay rates, half-lives, concentrations near detection limits). Optimisers
and samplers then work uniformly in base-10 log space.

### Observations and metrics

`parseCsv` turns a delimited text file into a `Dataset`: one strictly
increasing time axis and one array per observed series. It accepts commas,
semicolons or tabs, quoted fields, `NA`/`NaN`/blank cells (stored as `NaN`),
and ISO dates (converted to days since the first date). Missing observations
are dropped when the model is compared with data; they are never imputed.

A `FitMetrics` object summarises one paired series:

- `n` — number of paired observations.
- `sse` — sum of squared errors.
- `rmse` — root mean squared error (same units as the series).
- `nse` — Nash–Sutcliffe efficiency: 1 is perfect, 0 means "no better than
  the observed mean", negative means worse than the mean.
- `r2` — squared Pearson correlation (shape agreement, insensitive to bias).
- `bias` — mean(simulated − observed); positive means the model runs high.

An `OutputMetric` reduces the whole simulation to one number for sensitivity
analysis:

```ts
{ series: "DO_deficit", stat: "max" }          // worst oxygen deficit
{ series: "BOD", stat: "final" }               // end-of-run value
{ series: "DO_deficit", stat: "at", time: 2 }  // value at day 2
```

The other statistics are `min`, `mean` (time average by the trapezoid rule),
and `integral` (trapezoid over the saved points).

---

## 2. Calibration

Calibration finds parameter values that make simulated output close to
observed data. It is an optimisation problem: minimise a scalar **objective**
over the parameter ranges.

### Choosing an objective

| Objective | Formula (per series) | Use when |
| --- | --- | --- |
| `sse` | Σ(sim − obs)² | all series have similar magnitude and units |
| `wsse` | SSE / variance(obs), summed over series | series have different units or scales; this is usually the best default |
| `nse` | Σ(1 − NSE) | you want each series judged against its own mean; 0 is perfect |

`wsse` divides each series' error by its observed variance, so a good fit to
a small-magnitude series is not drowned out by a large-magnitude one. Optional
per-series `weights` multiply each contribution.

### Choosing an optimiser

- **Nelder–Mead** (`method: "nelder-mead"`, the default) is a local
  derivative-free search. It is fast and robust for smooth objectives but can
  stop in a local minimum. Use `starts: 5` or more to restart from Latin
  hypercube points.
- **Differential evolution** (`method: "differential-evolution"`) is a global
  population search. It is slower but much less sensitive to the starting
  point; use it when the objective is rough or you suspect several minima, or
  to confirm a Nelder–Mead result.

Both are deterministic for a given `seed`. `maxEvaluations` caps the number of
simulations and `tolerance` sets the relative objective change that counts as
convergence.

### The result

`calibrate` returns a `FitResult`:

- `parameters` — fitted values by name.
- `objective` — final objective value.
- `evaluations` — number of simulations used.
- `converged` — whether the optimiser met its tolerance.
- `alignments` and `metrics` — paired simulated/observed series and their
  goodness of fit.
- `identifiability` — standard errors, correlations and warnings (Section 3).
- `history` — best objective after each restart, for a convergence plot.

### Standard errors are approximate

The standard errors come from a local, linearised view of the objective at the
optimum. They assume independent, constant-variance residuals and a model that
is nearly linear in the parameters near the answer. Treat them as a guide to
which parameters are well determined, not as exact sampling errors. More
informative observations (large swings, many points, low noise) shrink them.

### Worked example: Streeter–Phelps

The model `examples/environmental/streeter-phelps.xmile` predicts BOD decay
and the dissolved-oxygen deficit downstream of a waste discharge. The data
file contains 21 days of observations with some missing BOD values.

```ts
import { readFileSync } from "node:fs";
import { calibrate, parseCsv } from "@sourcesink/analysis";
import { readXmile } from "@sourcesink/xmile";

const model = readXmile(
  readFileSync("examples/environmental/streeter-phelps.xmile", "utf8"),
);

const data = parseCsv(
  readFileSync("examples/environmental/streeter-phelps-observed.csv", "utf8"),
  {
    rename: {
      "BOD (mg/L)": "BOD",
      "DO deficit (mg/L)": "DO_deficit",
    },
  },
);

const fit = calibrate(
  model,
  data,
  [
    { name: "kd", min: 0.05, max: 1.0 }, // deoxygenation rate, 1/day
    { name: "ka", min: 0.05, max: 1.0 }, // reaeration rate, 1/day
  ],
  {
    method: "nelder-mead",
    objective: "wsse",
    starts: 1,
  },
);

console.log(fit.parameters);                    // { kd: 0.3440, ka: 0.5504 }
console.log(fit.identifiability.standardErrors); // { kd: 0.00412, ka: 0.00493 }
console.log(fit.metrics);
```

The fit is:

| Parameter | Estimate | Standard error |
| --- | ---: | ---: |
| `kd` (deoxygenation) | **0.3440 /day** | 0.0041 |
| `ka` (reaeration) | **0.5504 /day** | 0.0049 |

Fit quality:

| Series | n | RMSE | NSE | R² | Bias |
| --- | ---: | ---: | ---: | ---: | ---: |
| `BOD` | 17 | 0.0535 mg/L | 0.99991 | 0.99998 | +0.0291 mg/L |
| `DO_deficit` | 21 | 0.1353 mg/L | 0.99606 | 0.99643 | +0.0350 mg/L |

The fitted `ka > kd`, so the oxygen sag recovers, as the textbook solution
requires. The two parameters are only weakly correlated (correlation 0.16) and
there are no identifiability warnings. The objective is 0.0842 (weighted SSE,
so it is not directly comparable to a raw concentration error), reached in 66
simulations.

### Same fit from the command line

The `fit` command wraps this API. From an installed CLI:

```bash
sourcesink fit examples/environmental/streeter-phelps.xmile \
  --data examples/environmental/streeter-phelps-observed.csv \
  --param kd=0.05:1.0 \
  --param ka=0.05:1.0 \
  --rename "BOD (mg/L)=BOD" \
  --rename "DO deficit (mg/L)=DO_deficit" \
  --objective wsse \
  --starts 1
```

From a source checkout where the `sourcesink` executable is not on your
`PATH`, use `npx tsx src/cli/src/run.ts` in place of `sourcesink`:

```bash
npx tsx src/cli/src/run.ts fit examples/environmental/streeter-phelps.xmile \
  --data examples/environmental/streeter-phelps-observed.csv \
  --param kd=0.05:1.0 --param ka=0.05:1.0 \
  --rename "BOD (mg/L)=BOD" --rename "DO deficit (mg/L)=DO_deficit" \
  --objective wsse
```

Useful flags:

- `--param NAME=MIN:MAX[:log]` — repeat once per parameter; `:log` searches in
  log10 space.
- `--method nelder-mead|de` — `de` is differential evolution.
- `--starts N` — Nelder–Mead restarts from Latin hypercube points.
- `--seed N` — makes stochastic optimisers reproducible.
- `--json` — print the full `FitResult` instead of the report.
- `--write fitted.xmile` — save a copy of the model with the fitted constants
  as XMILE.

---

## 3. Identifiability: can the data tell the parameters apart?

A good fit does **not** guarantee that each parameter is separately
determined. Two parameters can trade off against each other: increasing one and
decreasing the other leaves the output almost unchanged. The data then cannot
pin down either one, even though the fit looks excellent.

SourceSink estimates a finite-difference Jacobian of the residuals at the
optimum and forms

```
covariance ≈ s² (JᵀJ)⁻¹,    s² = SSE / (n − p)
```

where `n` is the number of paired observations and `p` the number of
parameters. The diagonal gives squared standard errors; the off-diagonals give
correlations. `identifiability` reports:

- `standardErrors` — one per parameter, in the parameter's own units.
- `correlation` — matrix in `parameters` order; entries near ±1 mean the data
  cannot separate the pair.
- `warnings` — plain-language flags such as "K and r are strongly correlated
  (0.97)" or "theta has almost no effect on the fit (standard error > 10 ×
  range)".

What to do with a warning:

1. **Get more informative data.** Observations during a transient, or on a
   different series, usually break the trade-off.
2. **Fix one parameter** to an independent estimate (literature value, lab
   measurement) and fit the rest.
3. **Reparameterise** — for example fit a half-life instead of a rate, or a
   ratio instead of two absolute rates.
4. **Report the correlation** honestly; a wide joint uncertainty is a real
   result, not a failure of the optimiser.

In the Streeter–Phelps example the correlation is 0.16 and the standard errors
are small, so the data determine both rates well.

---

## 4. Sensitivity analysis

Sensitivity asks a different question: if inputs vary over stated ranges, which
ones matter for the output? Calibration gives one best-fit point; sensitivity
explores the neighbourhood (or a whole prior range) around it.

Always define the ranges deliberately. Sensitivity results are conditional on
the ranges you choose; a parameter that matters over a wide range may be
irrelevant over a narrow one.

### 4.1 Morris screening

Morris (1991) is a cheap screening method. Each **trajectory** starts at a
point on a p-level grid, then moves one parameter at a time by

```
Δ = p / (2(p − 1))
```

in the unit hypercube, evaluating the model after each move. A trajectory with
`k` parameters costs `k + 1` runs. For each parameter the **elementary effect**
is

```
EE = [y(x + Δe_i) − y(x)] / Δ
```

measured in the unit (normalised) space, so effects are comparable across
parameters with different units. For a log-scaled parameter the normalised axis
is log10, so its effect is per decade of the parameter. (The number of levels
must be even.) The tool reports:

- `mu` (μ) — mean signed effect. Shows the average direction; positive means
  increasing the parameter increases the output.
- `muStar` (μ*) — mean |EE|. The recommended ranking measure because positive
  and negative effects cannot cancel.
- `sigma` (σ) — spread of the effects. Large σ relative to μ* means the effect
  depends on where you are in the input space (nonlinearity or interaction
  with other parameters).
- `evaluations` — `r × (k + 1)`.
- `failed` — runs that threw or produced a non-finite metric.

Use Morris when you have many candidate parameters and need a fast ranking, or
as a pre-screen before Sobol. It does **not** apportion variance and can rank
two interacting parameters differently from a variance-based method.

```ts
import { morris } from "@sourcesink/analysis";

const params = [
  { name: "kd", min: 0.29, max: 0.40 },
  { name: "ka", min: 0.47, max: 0.63 },
];

const result = morris(model, params, { series: "DO_deficit", stat: "max" }, {
  trajectories: 20,
  levels: 4,
  seed: 1,
});

for (const p of result.parameters) {
  console.log(p.name, p.muStar.toFixed(3), p.sigma.toFixed(3));
}
```

### 4.2 Sobol' indices

Sobol' analysis decomposes the **variance** of the output into shares
attributable to each input and to their interactions. With output variance
`V`:

- **First-order** `S_i` — the fraction of `V` explained by parameter `i` alone.
- **Total** `S_Ti` — the fraction explained by `i` alone **plus every
  interaction involving `i`**. The difference `S_Ti − S_i` is `i`'s
  interaction share.

Useful identities for independent inputs:

- `Σ S_i ≤ 1`, with equality only when the model is additive.
- `Σ S_Ti ≥ 1`, with equality only when the model is additive.
- A parameter can have `S_i ≈ 0` but large `S_Ti`: it has no main effect but
  matters through interactions. This is exactly the Ishigami `x3` case below.

SourceSink uses the Saltelli (2010) scheme with Jansen's total-effect
estimator. It builds two base matrices `A` and `B` from one 2k-dimensional
Sobol' sequence, plus the `k` mixed matrices `A_B(i)`, for a cost of
`N × (k + 2)` model runs. Bootstrap resampling (default 200) gives 95%
percentile confidence intervals.

Guidance for `samples` (N):

- 256–512: quick screening.
- 1024–4096: reliable rankings and approximate shares.
- 8192 or more: publishable precision, especially when interactions are weak
  or the output variance is small.

Indices slightly below zero are estimator noise; a confidence interval that
contains zero means "no detectable effect".

```ts
import { sobol } from "@sourcesink/analysis";

const params = [
  { name: "kd", min: 0.29, max: 0.40 },
  { name: "ka", min: 0.47, max: 0.63 },
];

const result = sobol(model, params, { series: "DO_deficit", stat: "max" }, {
  samples: 1024,
  seed: 1,
  bootstrap: 200,
});

for (const p of result.parameters) {
  console.log(p.name, p.first.toFixed(3), p.total.toFixed(3));
}
```

### 4.3 Which method when?

- **Morris first** when there are more than roughly 10 parameters, or when
  each run is expensive. Drop parameters with negligible μ*.
- **Sobol** on the shortlist when you need quantitative variance shares,
  interaction structure, or a defensible ranking.
- **Both** when you want to show that the screening and variance-based
  conclusions agree (and to catch interaction-driven parameters that Morris
  under-ranks).

### 4.4 Sensitivity from the command line

```bash
sourcesink sensitivity examples/environmental/streeter-phelps.xmile \
  --param kd=0.29:0.40 \
  --param ka=0.47:0.63 \
  --metric DO_deficit:max \
  --method morris \
  --trajectories 20 \
  --seed 1
```

Switch to variance-based indices with `--method sobol --samples 1024`. The
metric grammar is `SERIES:STAT[@TIME]`, where `STAT` is
`final|max|min|mean|integral|at`; use `DO_deficit:at@2` for the value at day 2.
Add `--json` to print the raw result.

With the ranges above, the peak deficit is most sensitive to `kd` (Morris
μ* ≈ 1.17 versus ≈ 1.03 for `ka`), and a 1024-sample Sobol run attributes
roughly 55% of the variance to `kd` and 44% to `ka` in total, with a small
interaction share. Both coefficients matter; neither can be dropped.

---

## 5. Uncertainty analysis (Monte Carlo)

Sensitivity tells you which inputs matter. Uncertainty analysis tells you how
wide the output band is when those inputs vary. The recipe is:

1. Choose a probability distribution for each input (often uniform over a
   plausible range, or log-uniform for positive quantities).
2. Draw `N` samples — independent uniform draws, or a Latin hypercube for
   better coverage of each marginal range.
3. Run the model for every sample.
4. Summarise the output at each time: mean, standard deviation, and
   percentiles.

The percentiles describe the output distribution implied by your input
assumptions. They are **not** confidence limits on the true parameter values,
and they do not improve as you add runs beyond reducing Monte Carlo noise
(error scales like `1/√N`).

### Worked example: a dissolved-oxygen uncertainty band

Use the calibrated ranges around the fitted rates:

```bash
npx tsx src/cli/src/run.ts montecarlo \
  examples/environmental/streeter-phelps.xmile \
  --param kd=0.29:0.40 \
  --param ka=0.47:0.63 \
  --runs 500 \
  --seed 7 \
  --lhs \
  --columns DO_deficit \
  --percentiles 5,50,95
```

With the installed CLI, drop the `npx tsx src/cli/src/run.ts` prefix. The
command prints a CSV table with `time`, the mean and standard deviation, and
the requested percentiles. Selected rows from this run:

| day | mean | sd | p5 | p50 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2.000 | 0.000 | 2.000 | 2.000 | 2.000 |
| 2 | 6.415 | 0.460 | 5.669 | 6.354 | 7.226 |
| 6 | 3.073 | 0.366 | 2.521 | 3.046 | 3.684 |
| 10 | 0.937 | 0.188 | 0.651 | 0.923 | 1.270 |
| 20 | 0.035 | 0.016 | 0.015 | 0.032 | 0.064 |

The day-0 deficit is fixed by the initial condition, so the band has zero
width there. Uncertainty grows through the transient (largest near the sag
peak) and shrinks as reaeration relaxes the deficit, but the *relative* spread
at day 20 is large because the remaining deficit is small.

If you want the band on actual dissolved oxygen rather than the deficit,
select `DO` instead of `DO_deficit`; the model computes
`DO = DO_sat − DO_deficit`.

### The same thing in the API

```ts
import { latinHypercube, simulateEnsemble, summarize } from "@sourcesink/analysis";

const samples = latinHypercube(
  {
    kd: [0.29, 0.40],
    ka: [0.47, 0.63],
  },
  500,
  7,
);

const ensemble = simulateEnsemble({ base: model, samples, seeds: [7] });
const band = summarize(ensemble, ["DO_deficit"], [5, 50, 95]);

console.log(band.DO_deficit.percentiles[5]); // p5 series over time
```

Failed runs are recorded in `ensemble.runs[i].error` and skipped by
`summarize`; one bad sample does not discard the rest.

---

## 6. Worked example: Morris then Sobol on the Ishigami function

The Ishigami function is a standard sensitivity benchmark because it is
nonlinear and has a pure interaction:

```
y = sin(x1) + 7 sin²(x2) + 0.1 x3⁴ sin(x1),    x1, x2, x3 ∈ [−π, π]
```

The analytic indices (with a = 7, b = 0.1) are:

| Parameter | S_i (first) | S_Ti (total) |
| --- | ---: | ---: |
| `x1` | 0.3139 | 0.5576 |
| `x2` | 0.4424 | 0.4424 |
| `x3` | 0 | 0.2437 |

`x3` has no main effect — its average effect cancels — but it interacts
strongly with `x1` through the `x3⁴ sin(x1)` term, giving it a substantial
total effect.

The model is one converter evaluated once (a zero-length run):

```ts
import { emptyModel, type Model } from "@sourcesink/model";
import { morris, sobol } from "@sourcesink/analysis";

const ishigami: Model = {
  ...emptyModel("Ishigami"),
  converters: [
    { id: "x1", name: "x1", kind: "converter", equation: "0" },
    { id: "x2", name: "x2", kind: "converter", equation: "0" },
    { id: "x3", name: "x3", kind: "converter", equation: "0" },
    {
      id: "y",
      name: "y",
      kind: "converter",
      equation: "sin(x1) + 7*sin(x2)^2 + 0.1*x3^4*sin(x1)",
    },
  ],
  run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
};

const params = [
  { name: "x1", min: -Math.PI, max: Math.PI },
  { name: "x2", min: -Math.PI, max: Math.PI },
  { name: "x3", min: -Math.PI, max: Math.PI },
];

const metric = { series: "y", stat: "final" as const };

const screening = morris(ishigami, params, metric, {
  trajectories: 20,
  levels: 4,
  seed: 1,
});

const varianceShares = sobol(ishigami, params, metric, {
  samples: 4096,
  seed: 1,
  bootstrap: 200,
});
```

**Morris screening** (20 trajectories × (3 + 1) = 80 runs):

| Rank | Parameter | μ | μ* | σ |
| ---: | --- | ---: | ---: | ---: |
| 1 | `x2` | 2.36 | 7.88 | 7.51 |
| 2 | `x1` | 7.70 | 7.70 | 6.25 |
| 3 | `x3` | −1.25 | 6.25 | 8.75 |

Morris says all three are influential and puts `x2` narrowly first. The large
σ values, especially for `x3`, warn that the effects change sign or magnitude
across the input space — a hint of interaction.

**Sobol** (`N = 4096`, `4096 × 5 = 20,480` runs, 200 bootstrap resamples):

| Parameter | S_i | 95% CI | S_Ti | 95% CI |
| --- | ---: | --- | ---: | --- |
| `x1` | 0.3081 | [0.274, 0.347] | 0.5589 | [0.519, 0.606] |
| `x2` | 0.4409 | [0.404, 0.481] | 0.4412 | [0.421, 0.462] |
| `x3` | −0.0084 | [−0.051, 0.027] | 0.2456 | [0.232, 0.259] |

All estimates agree with the analytic values to within about 0.006. The output
variance over the base sample is 13.84. The confidence interval for `x3`'s
first-order index contains zero, so report it as zero, not as a small negative
number. Its total index, however, is clearly non-zero: `x3` matters only
through its interaction with `x1`.

This example is the reason to run both methods. Morris is cheap and ranks the
parameters plausibly, but only Sobol reveals that `x3` has no main effect and
that `x1` carries the largest total influence.

---

## 7. A practical workflow

1. **Plot and inspect the data.** Decide which series to fit, which to use as
   validation, and what the noise level is.
2. **Pick parameters and ranges from physics.** Use literature values and
   units; choose bounds wide enough to contain the truth but not absurd.
3. **Calibrate.** Start with `wsse` and Nelder–Mead with a few restarts. If the
   result depends on the starting point, try differential evolution.
4. **Read the fit metrics and the identifiability block.** A high R² with a
   huge standard error means the fit looks good but the parameters are not
   determined. Fix, reparameterise, or collect more informative data.
5. **Screen with Morris.** Drop parameters with negligible μ*.
6. **Quantify with Sobol** on the shortlist. Report first-order and total
   indices with confidence intervals; state `N`, ranges and seed.
7. **Propagate uncertainty** with Latin hypercube sampling and percentile
   bands. State the assumed distributions clearly.
8. **Report the assumptions.** Sensitivity and uncertainty results are only as
   meaningful as the ranges and distributions behind them.

## 8. Reproducibility

All samplers, optimisers and sensitivity estimators accept a `seed`.
Given the same model, options and seed, results are identical across runs and
platforms: the engine is deterministic and the analysis code uses a local
mulberry32 generator for sampling, sequence skips and bootstrap resampling.
Record the seed in any reported result.
