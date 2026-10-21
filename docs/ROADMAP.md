# SourceSink roadmap

**Status:** living document, updated October 2026. This is the single place
that describes where SourceSink is headed. Detailed engineering plans for
individual tracks live in [`docs/plans/`](plans/); feature documentation lives
beside the code it describes (for example [`analysis.md`](analysis.md) and
[`assistant.md`](assistant.md)).

## 1. Vision

SourceSink aims to be an open, provenance-aware modeling workbench for teaching
and research: a place where a stock-and-flow model is easy to build, honest
about its uncertainty, connected to data, able to explain itself, and useful
for making decisions. AI helps with authoring, analysis and explanation, but
the model, not the AI, is always the source of truth.

The first generation of system dynamics tools asked *can you build and run the
model?* The current generation asks *can you trust it, calibrate it and explain
it?* The next will ask *can the model learn from data, help design better
systems, and explain itself to someone who did not build it?* SourceSink is
built to answer the third question.

### Principles

1. **The engine stays deterministic and pure.** Every result is reproducible
   from the model, the run settings and the seed. AI never sits inside the
   integration loop.
2. **The diagram is the source of truth.** Changes from people, scripts or AI
   are reviewable model edits, never silent rewrites.
3. **Validate before simulating.** Every automated change passes parsing,
   structural checks, unit checks and a test run before anyone sees it.
4. **Every number has provenance.** Parameters, equations and data carry a
   source and an author (person, AI or import).
5. **Test against known answers.** Analytic solutions, published results and
   synthetic data with known parameters are the standard for every feature.
6. **AI lowers the cost of exploring, not the cost of thinking.** In teaching,
   students still predict before they run and defend the structure they build.
7. **Open formats and providers.** XMILE files; language models through
   provider-agnostic adapters; everything works offline except the assistant.

### What we will not build

- A language model inside the simulation loop.
- A chat-first interface that hides the diagram.
- Automatic equation rewriting without review.
- A surrogate or learned component presented as if it were the model.
- Proprietary file formats.

## 2. Where SourceSink stands (October 2026)

| Area | In place |
|---|---|
| Modeling | Stocks, flows, converters, connectors, graphical functions, arrays (1–2-D, per-element equations), scenarios, conveyors, queues and ovens, more than 60 built-in functions |
| Simulation | Euler, Runge–Kutta 2 and 4, adaptive RK45; seeded random streams; ensembles |
| Files | XMILE as the native format; import of legacy `.stm`/`.itm` models |
| Editor | Diagram editor with auto-layout and Tidy up, inspector with autocomplete, results graph and table, light and dark themes, desktop app for Linux, Windows and macOS, browser version |
| Checking | Unit and dimension checking, structural validation, plain-language description with feedback loops and a coverage check |
| Analysis | Calibration (Nelder–Mead, differential evolution, standard errors, identifiability warnings), Morris and Sobol sensitivity, Monte Carlo uncertainty bands |
| Assistant | Conversational model building through validated patches, answers grounded in local simulation runs, unit-aware repair, streaming replies, round-trip evaluation harness |
| Automation | `sourcesink` command line, MCP server for AI agents, patch format with a validation gauntlet |
| Content | 33 cited and tested example models in six areas; a user manual with seven tutorials; a guide for AI agents |
| Quality | More than 1,000 tests, including analytic checks for every example and an evaluation corpus with deliberately broken models |

## 3. Work ahead

Status codes: **Planned** (designed, ready to build), **Idea** (worth doing,
not yet designed), **Research** (open-ended, treat as a research program).

### Track A: Design and policy analysis

Detailed plan: [`plans/design-and-policy-features.md`](plans/design-and-policy-features.md).

| Item | Status | What it adds |
|---|---|---|
| Scenarios and overrides on every analysis command | Planned | Compare policies under uncertainty in one step |
| Scalar outcomes, windowed statistics, CVaR, histograms | Planned | "How often does this policy miss its target, and by how much in the worst cases?" |
| Independent random streams per Monte Carlo run | Planned | Stochastic disruption studies |
| Unit-syntax ergonomics | Planned | `kg/(m^2*month)`, `MAX(0, flow)` |
| `optimize` command (constraints, whole-number choices) | Planned | Best sizes, timings and policies inside the tool |
| Robust optimization (simulation-optimization) | Planned | Designs that perform under uncertainty, not only on paper |
| Trade-off frontiers (`pareto`) | Planned | Cost vs. emissions, waste vs. purchases |
| Allocation functions (proportional, priority) | Planned | Sharing a scarce supply: water, quotas, by-products |
| Producer × receiver network pattern | Planned | Parks, basins, supply chains |
| Co-flows (cost, emissions carried with material) | Planned | Economic and environmental accounting |
| Parallel ensembles | Planned | Several times faster Sobol and robust optimization |
| Policy comparison report | Planned | Publication-ready scenario comparisons |

### Track B: Understanding behavior

| Item | Status | What it adds |
|---|---|---|
| Loop dominance analysis | Idea | Which feedback loop drives the behavior in each phase of a run |
| Loop polarity through `MIN`, `MAX`, `IF` | Planned | Reinforcing/balancing labels where they are now "unknown" |
| Story mode | Idea | A plain-language narrative of a model, checked for completeness by having a fresh model rebuild the structure from the story |
| Counterfactual decomposition | Idea | How much of an outcome is due to this loop, this delay, this parameter |
| Scenario discovery | Idea | Which combinations of uncertain inputs lead to qualitatively different regimes |

### Track C: Inference and data

| Item | Status | What it adds |
|---|---|---|
| Bayesian calibration (priors, MCMC, posterior predictive bands) | Idea | Full uncertainty on fitted parameters, feeding directly into uncertainty bands |
| Residual diagnostics | Idea | Residual plots and autocorrelation checks, so a fit is credible |
| Run history and ensemble storage | Idea | Indexed, queryable runs; the evidence behind every result stays on record |
| Surrogate models | Idea | Fast emulators for many-query problems, always labeled with their error |
| Live data connections (digital twin) | Idea | Scheduled data feeds, recalibration and drift alerts, for utilities and agencies |
| Parameter lookup with sources | Idea | Literature values with citations recorded in provenance |

### Track D: Teaching

| Item | Status | What it adds |
|---|---|---|
| Grounded Socratic tutor | Idea | Questions about *this* model and run ("which loop explains the decline after year 10?") |
| Predict-then-run workflow | Idea | Students commit to a prediction before seeing the result; gradable |
| Structural critic | Idea | Flags missing links, implausible structures and claimed loops the wiring does not support |
| Bug-finding exercises | Idea | Instructor models with a planted structural error, with generated variants |
| Isomorphic problem generation | Idea | Same loop structure, new story, for practice and assessment |
| Misconception detection | Idea | Common structural errors across a class, surfaced for the instructor |
| Classroom sessions | Idea | Shared models, assignments and instructor dashboards with privacy-preserving defaults |
| Accessibility and languages | Idea | Screen-reader traversal of diagrams; explanations in the student's language |

### Track E: Sharing and interoperability

| Item | Status | What it adds |
|---|---|---|
| Publish a model as an interactive page | Idea | Sliders and charts for people without SourceSink |
| Fuller legacy import | Idea | Annotations, graph pads and tables from older files; confirm inferred oven settings |
| Signed installers | Idea | No unsigned-app warnings on Windows and macOS |

### Track F: The assistant

| Item | Status | What it adds |
|---|---|---|
| Harder evaluation set | Planned | Find where the assistant fails on multi-stock, oscillating and network models |
| Start from data | Idea | Drop a CSV into the conversation; get a proposed structure and a calibration |
| Assistant tools for the new analyses | Idea | Ask for a robust design or a loop-dominance explanation in conversation |

### Track G: Research frontier

| Item | Status | What it adds |
|---|---|---|
| Hybrid ML and system dynamics | Research | Learned rate functions inside a fixed stock-and-flow structure |
| Differentiable simulation | Research | Training learned components through the integrator |
| Causal discovery | Research | Candidate links and rate forms from data, shown as hypotheses, never auto-applied |
| Experiment design | Research | Choosing the most informative next runs and stress cases |

### Track H: Readability of large models

Small and medium models read well, but large ones can become unreadable. A
policy model of about 70 elements, written without connectors in its file,
showed the problem clearly: with no information links the layout had nothing
to anchor its 45 converters to, so they stacked into one tall column, and fit
to screen shrank the diagram to specks. Tidy up could not help, for the same
reason. Large models also suffer from many constants, repeated per-unit
structure and long crossing links.

| Item | Status | What it adds |
|---|---|---|
| Infer connectors from equations | Done | Files with missing or no links still draw (and lay out) correctly; one action connects everything an equation uses |
| Grid fallback and minimum zoom | Done | Elements with no anchor form a compact grid, never a single column; fit-to-screen stays legible |
| Show or hide constants; parameter table | Done | Plain constants collapse to small tags or a side table, decluttering the diagram |
| Validator warning for unlinked models | Done | Models (including AI-built ones) with no connectors are flagged |
| Focus mode | Idea | Highlight what feeds and is fed by the selected element; dim the rest |
| Sectors | Done | Named frames (XMILE groups) that fold into one card, with a fold-all overview; suggested from material chains and the links around them |
| Array suggestions | Done | Detects repeated per-unit structure (`Area_1` … `Area_4`) and converts it to arrays with unchanged results |
| Better sector suggestions | Idea | Smarter grouping for models whose material chains are tightly coupled (one large sector today) |
| Ghost copies | Idea | Duplicate a widely used value next to each consumer instead of drawing long lines |
| Multiple views | Idea | Separate diagram pages for parts of one model (XMILE supports this) |
| Zoom-dependent detail and a minimap | Idea | Sector boxes and main flows when zoomed out; detail when zoomed in |
| Layered layout engine for large models | Idea | Crossing-minimized layout with right-angled connectors, arranged by sector |
| Lighter connectors | Idea | Links from constants shown on hover or selection; parallel links bundled |
| Dashboard tiles for indicators | Idea | Accounting totals and KPIs shown as tiles rather than canvas elements |
| Assistant conventions | Idea | The assistant declares connectors, uses arrays and assigns sectors when it builds a model |

## 4. Suggested order

1. **Readability quick fixes** (Track H: inferred connectors, grid fallback,
   constants toggle, validator warning). Small, and without them large models
   cannot be read at all.
2. **Track A, phase 1** (scenarios on every command, scalar outcomes, random
   streams, unit syntax). A few days; removes the main frictions in policy
   studies.
3. **Loop dominance and story mode** (Track B). The clearest step toward a
   model that explains itself, and the foundation for the tutor.
4. **Optimization and trade-offs** (Track A, phase 2). The core of design studies.
5. **Bayesian calibration and residual diagnostics** (Track C).
6. **The teaching layer** (Track D), starting with predict-then-run and the
   grounded tutor, which build directly on items 3 and 5.
7. **Sectors, focus mode and array suggestions** (Track H), before models
   grow larger with networks.
8. **Networks, allocation and co-flows** (Track A, phase 3).
9. **Research frontier** (Track G) as a research program alongside the above.

The order follows one rule: make results trustworthy and explainable before
making them automatic.

## 5. How we will know it works

**Analysis.** Parameter recovery from synthetic data; sensitivity rankings that
match analytic cases; optimizers that find known optima; uncertainty bands that
contain observations at the stated rate; surrogate error reported out of sample.

**The assistant and AI features.** Share of AI-built models that pass
validation and match a reference structure (the round-trip harness); repair
iterations per turn; references to nonexistent elements or sources; share of
proposals accepted without edits; cost per turn.

**Teaching.** Learning gains against a comparison section; fewer structural
misconceptions over a term; better prediction accuracy; transfer to models the
student did not build; whether the tool narrows or widens gaps between students.

**Readability.** Every example and evaluation model draws with all its links,
no overlapping shapes after Tidy up, and readable text at fit-to-screen; large
test models (50+ elements) are part of the visual checks.

**Research.** Whether an independent user can reproduce a result from the
model file and its provenance, and whether an analysis changes a stated
decision.

## 6. Risks and guardrails

| Risk | Guardrail |
|---|---|
| People accept plausible AI models uncritically | Reviewable diffs, provenance badges, critique exercises |
| Language models invent links and equations | Schema, validation and test runs; nothing is applied without review |
| Convenience erodes understanding of feedback and integration | Prediction-first teaching; equations and derivations stay visible |
| Fast approximations mistaken for the model | Surrogates labeled, with reported error; the engine stays authoritative |
| Learned components fit noise and extrapolate badly | Regularization, held-out periods, uncertainty estimates, structural checks |
| Classroom data harms students | Local-first defaults, anonymization, institutional control |
| Lock-in to one AI provider | Provider-agnostic adapters; offline core |
| Features decay as models and APIs change | Evaluation harness, versioned prompts, a small typed tool surface |
| Scope creep | Prioritize teaching and research value over matching every feature elsewhere |

## Appendix: method families to draw on

- **Calibration and optimization:** Nelder–Mead, pattern search,
  Levenberg–Marquardt, differential evolution, CMA-ES, Bayesian optimization.
- **Sensitivity and uncertainty:** Morris screening, Sobol decomposition, Latin
  hypercube and Sobol sampling, Monte Carlo ensembles, Gaussian-process emulation.
- **Structure discovery:** Granger causality, PCMCI+, convergent cross mapping,
  sparse identification of nonlinear dynamics (SINDy), regime-shift detection.
- **Hybrid modeling:** residual correction, learned closures, neural and
  universal differential equations, differentiable simulation.
- **Explanation:** loop dominance and eigenvalue elasticity, counterfactual
  simulation, Shapley-style decomposition, provenance graphs.
- **Teaching:** predict-observe-explain, model elicitation, misconception
  inventories, structural similarity clustering.

Formal citations and a literature review should be added before this roadmap is
used in a proposal or publication.
