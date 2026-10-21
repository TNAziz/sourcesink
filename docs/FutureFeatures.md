# Future features

**Status:** a list of candidate upgrades, October 2026. It complements the
longer roadmap in [`FUTURE.md`](FUTURE.md). Items are grouped by purpose, and
the first group is the recommended order.

## Recommended next

### 1. Loop-dominance analysis
Show which feedback loop drives the behavior at each point in a run (e.g.,
"the growth loop dominates until day 12, then the crowding loop takes over").
The structural loop finder in `@sourcesink/explain` already exists. This is
the main analysis that commercial tools offer and SourceSink lacks, and it
would give the assistant far better explanations than "the stock went up."

### 2. Story mode
Write a plain-language narrative of a model, grounded in the structural
description and checked for completeness. The evaluation harness can test it:
a fresh model rebuilds the model from the story alone, and the two are
compared.

### 3. Bayesian calibration
Fit parameters with priors and report full posterior distributions (e.g.,
MCMC), not only a best fit with standard errors. The posteriors would feed
the uncertainty bands directly. This matters for research and regulatory use.

### 4. Residual diagnostics
Residual plots, autocorrelation of residuals and checks against the
calibration assumptions. A fit is only convincing when its residuals look
right.

## Sharing and use

### 5. Share a model as an interactive page
Publish a model as a web page with sliders, so a manager, regulator or
student can explore it without installing anything.

### 6. Policy and scenario dashboards
Compare scenarios side by side against targets (e.g., "keep DO above
5 mg/L"), and search automatically for the policy that meets them.

### 7. Run history
Store every run with its settings and results, so runs can be compared over
time and the evidence behind an assistant answer stays on record.

### 8. Fuller legacy import
Bring over the old diagrams' annotations, graph pads and tables, and confirm
the inferred oven settings against reference output.

## Data and research

### 9. Live data connections
Pull observations from CSV feeds, USGS gauges and other sources on a
schedule, recalibrate, and flag when the model drifts from what is observed.
This is the "digital twin" item in `FUTURE.md` and a natural fit for water
utilities.

### 10. Surrogate models
Train a fast emulator on ensemble runs so sensitivity analysis and
optimization finish in seconds on large models.

### 11. Parameter lookup with sources
The assistant finds literature values for a parameter (e.g., a typical
reaeration rate for a shallow stream) and records the citation in the
element's provenance.

## Assistant

### 12. Harder evaluation set
Run the round-trip harness on harder models (epidemic, predator–prey,
nutrient chains) to find where the assistant breaks, and improve the prompt
and repair loop there.

### 13. Start from data
Drop a CSV into the conversation; the assistant proposes a structure and
calibrates it in one pass.
