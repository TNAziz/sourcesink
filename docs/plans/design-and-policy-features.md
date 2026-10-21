# Plan: design and policy analysis features

**Status:** proposed, October 2026.

SourceSink can build, run, calibrate and stress-test a model. It cannot yet
*design* with one: choose the structure, sizes or timing that perform best,
compare policies across uncertainty, or allocate a scarce resource among
competing users. A study of an industrial-symbiosis park (one firm's
by-product feeding others' inputs) exposed these gaps concretely. The same
gaps appear in water supply allocation, fisheries quotas, supply chains and
infrastructure phasing.

This plan adds those capabilities in four phases, each useful on its own.

## Phase 1: Policies and outcomes across every analysis (small)

### 1.1 `--scenario` and `--set` on every analysis command
`sweep`, `montecarlo`, `sensitivity` and `fit` accept `--scenario <name>` and
repeatable `--set NAME=VALUE`, applied to the base model before the analysis
(the same order as `run`: scenario, then sets). The Analyze panel gets a
"Scenario" selector. A `--scenarios a,b,c` form on `montecarlo` and
`sensitivity` runs the same analysis once per scenario and reports them side
by side.

### 1.2 Scalar outcomes and windowed statistics
A shared metric grammar for every command: `SERIES:STAT[@window]` where STAT is
`final`, `max`, `min`, `argmax`, `argmin`, `mean`, `integral`, `at@T`, and a
window `@T1:T2` restricts it (e.g. `landfill_rate:mean@36:60`). New
`montecarlo --metric …` (repeatable) reports each run's scalar outcome with
mean, standard deviation, percentiles, CVaR at a chosen level, and a histogram
(CSV and JSON). The Uncertainty tab shows the distribution of a chosen metric
beside the bands.

### 1.3 Independent random streams per run
`montecarlo --seeds independent` gives each sample its own seed, so models with
`RANDOM`, `NORMAL` or `POISSON` disruptions vary from run to run (today one
seed is shared). Default stays reproducible: the stream for run *i* derives
from `--seed` and *i*.

### 1.4 Units ergonomics
Accept parentheses in unit strings (`kg/(m^2*month)`), and treat a literal 0 as
unit-polymorphic in `MIN`, `MAX` and comparisons (`MAX(0, flow)`).

**Enables:** policy comparison under uncertainty in one command; "how often
does this policy exceed its target, and how bad is the worst 10%" answers;
stochastic disruption studies.

## Phase 2: Optimization (medium)

### 2.1 `sourcesink optimize`
Minimize or maximize a metric over parameter ranges, reusing the existing
Nelder–Mead and differential-evolution optimizers:

```
sourcesink optimize model.xmile \
  --param area_1=0:100 --param area_2=0:100 --param start_3=0:24 \
  --minimize landfill_rate:mean@36:60 \
  --constraint "total_area<=100" --constraint "virgin_supply:max<=150" \
  [--integer start_3] [--scenario base] [--json] [--write best.xmile]
```

Constraints are metrics with a bound, enforced by an adaptive penalty;
`--integer` rounds selected parameters (with DE) for whole-number choices such
as start months; binary include/exclude choices are integer parameters on
[0, 1]. The report lists the optimum, the active constraints, and how
sensitive the objective is around the optimum.

### 2.2 Robust optimization (simulation-optimization)
`--robust --uncertain beta=3.2:4.8 --uncertain realization=0.5:1 --runs 64
--objective mean|quantile:0.9|cvar:0.9` scores each candidate design by its
outcome distribution over a fixed set of uncertainty samples (common random
numbers, so candidates are compared fairly). It returns the robust design and
compares it with the deterministic optimum under the same uncertainty.

### 2.3 Trade-off frontiers
`sourcesink pareto` traces the frontier between two metrics by the
ε-constraint method (minimize one subject to a sweep of bounds on the other),
e.g. landfilled waste against virgin material purchased, or cost against
emissions. Output: the frontier points with the design at each.

### 2.4 In the app
An **Optimize** tab in the Analyze panel: decision parameters, objective,
constraints, optional uncertainty set, progress, the best design with
"Apply", and a frontier chart.

**Enables:** finding the best sizes, timings and policies inside the tool;
robust designs that trade a little paper optimality for much less risk;
explicit trade-off curves for decision makers.

## Phase 3: Networks and accounting (larger)

### 3.1 Allocation of a scarce supply
Built-in allocation for arrayed demands, building on the existing array
support (`SUM(x[*])` already expands over a dimension):

- `ALLOCATE_PROPORTIONAL(supply, request[*])`: each element receives its share
  of the supply in proportion to its request, never more than requested.
- `ALLOCATE_PRIORITY(supply, request[*], priority[*])`: higher priority first;
  ties share proportionally.

Both are evaluated per element inside an arrayed equation and conserve the
supply exactly (tests check conservation and the edge cases: zero supply,
supply exceeding total demand, zero requests).

### 3.2 Producer × receiver networks
A worked pattern and an example model for two-dimensional arrays: a match
matrix `match[producer, receiver]` (0/1 or a fraction), allocation of each
producer's output across its matched receivers, and per-link stocks for
contracts or capacity. A "network" view in Describe lists the links.

### 3.3 Co-flows (attributes carried with material)
Declare an attribute per stock, such as cost per kg, CO₂ per kg or energy per
kg. SourceSink carries it through the flows (mass-weighted mixing in the
stock) and reports attribute totals and rates. This gives cost and emissions
accounting without duplicating the model structure.

### 3.4 Loop polarity through MIN, MAX and IF
Infer the polarity of links through these functions from the active branch at
a reference run (or a local derivative), so loops are reported as reinforcing
or balancing instead of "unknown".

**Enables:** park-, basin- or supply-chain-scale models with many producers and
users; allocation and priority policies (shortage sharing, water rights,
quotas); cost and emissions co-benefits of a design.

## Phase 4: Speed and reporting (medium)

### 4.1 Parallel ensembles
Run ensemble samples across worker threads (CLI and app). Sobol and robust
optimization, which need thousands of runs, become several times faster.

### 4.2 Policy comparison report
A one-page comparison of scenarios: outcome distributions, target exceedance
probabilities, and time series bands side by side, exportable as CSV and as a
figure for papers.

## What this lets a study explore

Taking the industrial-symbiosis case as the example, with the general use in
parentheses:

| Question | Features used |
|---|---|
| How much worse does an optimal design perform once uncertainty, delays and partial uptake are included? | 1.1, 1.2 (scenario ensembles with scalar outcomes, CVaR) |
| What design minimizes expected or tail waste, not just nominal waste? *(robust design of any system)* | 2.1, 2.2 |
| When should each industry be built, and in what order? *(infrastructure phasing)* | 2.1 with integer start times, 1.2 windowed metrics |
| What is the trade-off between landfill and virgin purchases, or cost and emissions? | 2.3, 3.3 |
| How should a scarce by-product be shared among receivers, and does the rule matter? *(water allocation, quotas)* | 3.1, 3.2 |
| How do disruptions at one supplier propagate through the network? | 3.2, 1.3 (independent random streams) |
| What uptake rate of planned exchanges is consistent with observed deliveries? | existing `fit` + 1.1 (`--scenario`) + identifiability warnings |
| Which policies are worth their cost? | 3.3 co-flows + 4.2 reports |

## Order and effort

| Phase | Scope | Rough effort |
|---|---|---|
| 1 | scenario/set everywhere, scalar metrics and windows, per-run seeds, units ergonomics | small: a few days |
| 2 | optimize (deterministic, constrained, integer), robust optimization, pareto, Optimize tab | medium: about two weeks |
| 3 | allocation builtins, network pattern and example, co-flows, loop polarity | larger: two to three weeks |
| 4 | parallel ensembles, policy comparison report | medium: about a week |

Phase 1 unblocks the most for the least work and should go first. Phase 2 is
the heart of design studies. Phase 3's allocation builtins can start in
parallel with Phase 2 because they touch the engine, not the analysis layer.

## Verification

Each feature ships with tests against known answers:

- optimization on functions with known optima, and on a model whose optimal
  parameter is analytic (e.g. a harvest rate that maximizes sustained yield,
  rK/4 at r/2);
- robust optimization against a case where the robust and nominal optima are
  known to differ;
- allocation conservation and priority order;
- co-flow mass balance;
- frontier points that dominate random designs;
- the existing example library re-run through the new commands.
