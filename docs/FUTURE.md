# The Future of System-Dynamics Tools in Teaching and Research

### A capability comparison and AI/ML roadmap for SourceSink

**Status:** working document, October 2026 — Phase A (§10 steps 1–8) and the core of Phase B (calibration, sensitivity, uncertainty) completed 2026-10-18; see "Progress" below
**Scope:** SourceSink (`~/Projects/sourcesink`), the class of visual stock-and-flow tools, and the teaching and research capabilities that could differentiate a next-generation tool.
**Method:** review of the current SourceSink code and docs, compared against the public capabilities of established commercial and open system dynamics tools and the open XMILE/PySD ecosystem.

---

## Executive summary

The mature tools have converged on four things: simulation correctness, calibration and uncertainty analysis, deployment to non-modelers, and interoperability. SourceSink started with the core every stock-and-flow tool needs (a map editor, a deterministic engine, XMILE files, and an importer for legacy `.stm`/`.itm` models) in a modern web and desktop shell. That is a credible open foundation, but it is not yet a competitor to the current commercial tools.

The opportunity is not to re-add, one by one, the features that Vensim, Powersim, AnyLogic, and GoldSim already have. It is to make the model itself machine-readable, explainable, and connected to data: an open, provenance-aware modeling workbench in which AI assists with authoring, calibration, explanation, and teaching without ever becoming the source of truth.

For **teaching**, the scarce skill is no longer drawing the diagram or writing the equation. It is deciding what to include, interpreting feedback, and recognizing when a model is structurally wrong. AI should act as a Socratic critic, scenario generator, and misconception detector — not as an answer machine that removes the learning activity.

For **research**, the frontier is hybrid modeling: stock-and-flow structure for the mechanisms we understand, learned components for the ones we do not, with explicit uncertainty and causal provenance. SourceSink's pure, deterministic engine and typed IR are a good substrate for that, provided the engine stays deterministic and AI lives outside it.

**Recommended first moves:**

1. Finish arrays/subscripts and RK2/RK4/adaptive integration.
2. Add a provenance-aware model schema and a reviewable model-diff format.
3. Expose model construction, validation, and simulation as a tool API (MCP).
4. Build calibration, global sensitivity, and a grounded model explainer.
5. Only then attempt generative natural-language model authoring.

### Progress (2026-10-18)

All eight "immediate next steps" in §10 are now in the code, with tests
(605 passing; every one of the 85 legacy sample models imports and simulates):

| §10 step | Where | Status |
|---|---|---|
| 1. Simulate arrays | `src/engine/src/arrays.ts` (compiled to scalar elements), XMILE `<dimensions>`/`<element subscript>`, editor Dimensions panel and per-element equations, legacy import as native arrays | Done |
| 2. RK2/RK4 and adaptive stepping | `src/engine/src/simulate.ts`: Heun RK2 and classic RK4, adaptive Dormand-Prince RK45 | Done |
| 3. `simulateEnsemble` and seeded RNG streams | `@sourcesink/analysis` (overrides, scenarios, grid/uniform/Latin-hypercube sampling, summaries); CLI `sweep`, `montecarlo` | Done |
| 4. Provenance and metadata | IR `Provenance`/`ModelMetadata`/`Scenario`; XMILE `ss:` extension namespace; import stamps; editor provenance field, AI badge and scenario manager | Done |
| 5. Model patch format and validation gauntlet | `@sourcesink/patch`: 9 operations, schema → apply → parse → structure → smoke run, Markdown diffs | Done |
| 6. MCP tool surface | `@sourcesink/mcp`: 10 tools (`model.create/open/get/patch/validate/simulate/ensemble/explain/export/history`) and 2 resources, stdio server | Done |
| 7. One grounded explainer | `@sourcesink/explain`: causal links with polarities, feedback loops, a full structural description and a completeness check; CLI `explain`, app "Describe" view | Done (structural; no LLM narration yet) |
| 8. Evaluation corpus | `tests/corpus/`: 43 original models with analytic checks (incl. arrays, RK, scenarios), 22 broken models | Done |

#### Phase B core (2026-10-18)

| Capability | Where | Status |
|---|---|---|
| Observations | `parseCsv` (NA cells, renames, unit-suffixed headers), alignment by interpolation, SSE / weighted SSE / NSE objectives, per-series RMSE, NSE, R² and bias | Done |
| Calibration | `calibrate()`: bounded Nelder–Mead with restarts or differential evolution, linear/log parameters; standard errors and correlations from the Jacobian, identifiability warnings. Recovers kd = 0.346 ± 0.002 and ka = 0.551 ± 0.005 (truth 0.35, 0.55) on noisy Streeter–Phelps data | Done |
| Sensitivity | Morris screening (μ*, σ) and Sobol first-order/total indices with bootstrap CIs (Saltelli 2010, Jansen) on a Joe–Kuo Sobol sequence identical to SciPy's; checked against the analytic Ishigami values | Done |
| Uncertainty | Latin-hypercube ensembles with 5/25/50/75/95% bands | Done |
| Surfaces | CLI `fit` and `sensitivity`; MCP `model.calibrate` and `model.sensitivity`; app Analyze panel (Calibrate / Sensitivity / Uncertainty, run in a Web Worker); `docs/analysis.md` | Done |

#### Phase D/E: modeling assistant (2026-10-19)

The conversational assistant (§5.3 item 1, and the grounded tutor) is built:
an interview that drafts the model as validated, reviewable patches; answers
grounded in local simulation runs; unit checking (`@sourcesink/units`, also a
gauntlet stage and CLI command); a persistent, authenticated OpenCode server
with streamed replies; and a round-trip evaluation harness. See
`docs/assistant.md`.

Not yet: priors and Bayesian calibration (MCMC), residual diagnostics,
ensemble storage, loop-dominance analysis, a story/narration mode on top of
the explainer, and confirming the inferred oven settings in legacy imports against reference output.

---

## 1. Where the class of tools stands

Visual system-dynamics tools have been stable in concept for four decades and volatile in capability for the last ten years. The concept is unchanged: stocks accumulate, flows move material, converters compute, connectors carry information, and a numerical integrator advances the state.

What has changed is everything around that core.

| Capability | State of the art | Consequence |
|---|---|---|
| **Solvers** | Euler, RK2/RK4, adaptive step, stiff solvers, discrete-event extensions | Models can be run at production fidelity, not just for teaching |
| **Arrays/subscripts** | Multi-dimensional arrays over named dimensions; arrayed equations and runs | Regional, sectoral, and cohort models without duplicating diagrams |
| **Calibration** | Optimization against time-series data; multi-start; constrained parameters | Models can be fitted to observations rather than hand-tuned |
| **Uncertainty** | Monte Carlo, Latin hypercube, Morris and Sobol sensitivity, probabilistic inputs | Results become distributions and confidence bands, not single lines |
| **Hybrid modeling** | SD + agent-based + discrete-event in one model; GIS and network layers | Heterogeneous populations, space, and operations become representable |
| **Deployment** | Browser players, cloud runs, interactive dashboards, workshop interfaces | Stakeholders can explore scenarios without owning the software |
| **Interoperability** | XMILE, SMILE, FMI/FMU co-simulation, Python/R/Excel APIs | Models can move between tools and couple to physical or data models |
| **Openness** | Open-source engines and transpilers (PySD, BPTK-Py, SDEverywhere, OpenModelica) | Reproducibility and auditability improve; lock-in weakens |

The important shift is philosophical. The first generation of tools asked, *can you build and run the model?* The current generation asks, *can you trust it, calibrate it, explain it, and put it in front of decision-makers?* The next generation will ask, *can the model learn from data and explain itself to a human who did not build it?*

### 1.1 What each mature tool is actually good at

- **Classic visual stock-and-flow tools** remain the clearest teaching environments and the easiest participatory-modeling surfaces, optimized for conceptual clarity rather than large-scale calibration or uncertainty work.
- **Vensim** is the research workhorse: subscripting, optimization and Monte Carlo in DSS, external functions, and a model engine used by high-profile climate simulators. It is less approachable for novices and weaker as a collaborative teaching surface.
- **Powersim Studio** is strong in multi-dimensional models, optimization, Excel/data connectivity, and cloud deployment, especially in energy and utility planning.
- **AnyLogic** is the reference for hybrid models: SD plus agent-based plus discrete-event, with GIS, Java extensibility, and cloud execution. It is the right tool when the system is not well described by aggregate feedback alone.
- **GoldSim** is the engineering-risk counterpart: probabilistic simulation, Monte Carlo orchestration, contaminant transport, reliability, and decision dashboards. It is closer to a quantitative risk workbench than to a conceptual modeling tool.
- **Insight Maker** demonstrates the value of a free, browser-first, low-friction surface for SD and simple agent models.
- **OpenModelica** and the Modelica ecosystem represent the acausal, equation-based alternative: composable physics rather than stock-flow abstraction, increasingly coupled to SD models through FMI.

The class is therefore not one market. It is at least four: **conceptual teaching tools**, **policy research platforms**, **engineering risk simulators**, and **hybrid/agent simulation environments**. A new tool must choose which conversation it is entering.

---

## 2. Where SourceSink stands

SourceSink is an open-source system dynamics environment written in TypeScript. At the time of this review the repository contained a meaningful, testable core:

- A **typed model IR** (`src/model/src/index.ts`) covering stocks, flows, converters, connectors, graph functions, dimensions, array specs, and run specs.
- A **pure simulation engine** (`src/engine/src/simulate.ts`) with Euler integration, dependency ordering, stateful built-ins (SMTH, DELAY, TREND, RANDOM, conveyors, queues, ovens), and cycle-time functions.
- **XMILE read/write** as the canonical open format, plus a **legacy `.stm`/`.itm` importer**.
- A **React/Vite diagram editor** with run, graph, and table views; Electron packaging; a headless CLI; and an environmental-engineering example library.
- **Tests** for the engine, wiring, built-ins, XMILE round-trips, and the legacy parser.

This is a strong foundation, but it covered only the classic modeling core. The gap to current tools was not cosmetic.

### 2.1 Capability comparison

| Capability | SourceSink today | Mature tools | Research implication |
|---|---|---|---|
| Stock-and-flow editor | Yes | Yes | At parity for basic authoring |
| Euler integration | Yes | Yes | At parity for simple models |
| RK2/RK4/adaptive | Euler, RK2, RK4 and adaptive RK45 | Standard | At parity |
| Arrays/subscripts | Simulated (apply-to-all, per-element equations, wildcards); editor and XMILE support | Standard in established tools | At parity for 1–2-D arrays; arrayed graph functions pending |
| Calibration/optimization | No | Standard in established commercial tools | Blocks data-driven research use |
| Global sensitivity | No | Standard add-ons | Blocks publishable uncertainty analysis |
| Monte Carlo/ensembles | Ensemble runner, grid/uniform/LHS sampling, summary bands (CLI and MCP) | Standard | Foundation in place for UQ |
| Hybrid ABM/DES | No | AnyLogic, partly others | Limits heterogeneous systems |
| GIS/spatial layers | No | AnyLogic, some others | Limits catchment and network models |
| Web/cloud deployment | Local web UI and desktop app | Mature cloud players | Limits classroom and stakeholder reach |
| XMILE | Yes | Yes | Good strategic choice |
| Legacy `.stm`/`.itm` import | Yes (best effort) | N/A | Valuable migration path |
| Open source | Yes, MIT | Mostly proprietary | Differentiator for science |
| Provenance/reproducibility | Element and model provenance, scenarios, patch history | Partial | Differentiator, now built in |
| AI/ML assistance | MCP tool surface, validated patches, structural explainer | Emerging, mostly bolt-on | Foundation ready for AI features |

### 2.2 The honest assessment

At the time of this review SourceSink was a **solid classic stock-and-flow tool**, not yet a next-generation one. Its strongest assets are architectural rather than feature-level:

1. The engine is a pure function of `(model, run spec)`, with no I/O. That makes calibration, sensitivity, surrogate training, and reproducible experiments straightforward to add.
2. The IR is typed and close to XMILE, so it can be serialized, diffed, embedded, and reasoned about by tools.
3. The project is MIT-licensed and Linux-native, which matters for teaching labs, reproducibility, and public-sector use.

The weakest points are equally clear: no arrays in simulation, Euler only, no calibration or uncertainty machinery, no collaboration, and no data connection. The AI opportunity is real precisely because those gaps exist — a new layer can be designed around them rather than retrofitted onto a legacy architecture.

---

## 3. The future of these tools in teaching

### 3.1 What changes

For thirty years, the bottleneck in teaching system dynamics was **syntax and construction**: students spent most of their time learning the iconography, the equation dialect, and the mechanics of running a model. AI removes much of that friction. That is not an unmixed blessing.

When construction is cheap, three things become scarce:

- **Judgment about boundaries.** What is endogenous? What is exogenous? What was left out, and does it matter?
- **Interpretation of dynamics.** Why does the stock overshoot? Which loop dominates early, and which dominates late? Why does a policy that helps in year 2 hurt in year 20?
- **Model criticism.** Is the structure plausible, or merely capable of reproducing the historical curve?

A teaching tool for the next decade should therefore shift assessment from *did you build the diagram correctly?* to *can you defend the structure, diagnose the behavior, and revise the model when the evidence changes?*

### 3.2 What should not change

The diagram must remain the source of truth. A chat-first interface that hides the stock-and-flow structure would undermine the very skill the course exists to teach. AI should propose changes as **visible, reviewable diffs** to the diagram and equations, never as silent edits.

Similarly, students should still predict before they run. The pedagogical value of simulation comes from the tension between expectation and result. An AI that immediately explains the output removes that tension. The tool should be able to *withhold* explanation, ask the student to commit to a prediction, and then reveal the result.

### 3.3 Teaching capabilities worth building

1. **Grounded Socratic tutor.** The tutor reads the actual model graph and simulation output, then asks questions such as "Which loop is responsible for the decline after year 10?" It does not generate a generic essay about systems thinking.
2. **Structural critic.** Before a run, the tool flags missing connectors, dimension mismatches, implausible units, stocks with no outflow, and loops that the student claims exist but the wiring does not support.
3. **Predict-then-run workflow.** The student records a prediction; the tool runs the model, shows the divergence, and asks for a structural explanation. This can be graded.
4. **Bug-finding exercises.** The instructor ships a model with a subtle structural error (wrong polarity, missing delay, misplaced accumulation). The student must find and repair it. AI can generate variants at scale.
5. **Isomorphic problem generation.** Given a target concept (overshoot, oscillation, tipping point), generate a new scenario with the same underlying loop structure but a different surface story.
6. **Misconception detection.** Cluster student models by structural signature and flag common errors: treating a flow as a stock, omitting a feedback, using a converter where a stock is required, confusing correlation with causality.
7. **Accessible and multilingual modeling.** Natural-language descriptions of diagrams, screen-reader-friendly graph traversal, and equation explanations in the student's language.
8. **Classroom studios.** Shared model sessions, instructor dashboards, and anonymized comparison of student structures — with privacy-preserving defaults.
9. **Assessment that resists automation.** Require students to explain *why* a change alters behavior, to critique an AI-generated model, or to reconcile two models that fit the same data but imply different mechanisms. These tasks are hard to outsource to a chatbot and pedagogically valuable.

The design principle is consistent: **AI lowers the cost of exploring, not the cost of thinking.**

---

## 4. The future of these tools in research

### 4.1 From simulation to inference

The traditional research workflow is: specify a model, pick parameters, run scenarios, report trajectories. The modern workflow is: specify a model *family*, condition it on data, quantify uncertainty, and identify which structures and parameters are actually supported.

That shift requires four capabilities that SourceSink does not yet have:

- **Calibration** of parameters against observations, with bounds and priors.
- **Global sensitivity** to identify which inputs matter and which can be fixed.
- **Uncertainty propagation** so that outputs are distributions, not lines.
- **Structural comparison** so that competing model structures can be scored, not just competing parameter sets.

### 4.2 From single models to model ensembles

Complexity is rarely understood from one run. Researchers need ensembles over parameters, structures, scenarios, and seeds; they need to see where trajectories diverge and which assumptions drive the divergence. This is as much a data-model problem as a simulation problem: runs must be indexed, stored, queried, and compared.

### 4.3 From black-box ML to hybrid structure

Pure machine learning is good at prediction and bad at explanation. Pure system dynamics is good at explanation and bad at learning from data. The productive frontier is hybrid:

- Keep the **stock-flow skeleton** where the accounting and causal structure are known.
- Replace unknown **rate functions or closures** with learned components trained against data.
- Use **differentiable simulation** to train those components through the integrator.
- Report both the learned component and its uncertainty, and test whether the hybrid model generalizes outside the calibration period.

This is where a clean, pure engine has a strategic advantage. A differentiable or gradient-friendly engine can support neural-ODE-style training and hybrid calibration that legacy commercial tools cannot easily match.

### 4.4 Understanding complexity, operationally

"Understanding complexity" should be made concrete. A tool can support it by providing:

- **Loop dominance analysis** over time: which feedback loops explain the behavior in each phase.
- **Counterfactual decomposition**: how much of the outcome is due to this loop, this delay, this parameter?
- **Near-decomposability analysis**: which subsystems can be studied independently without losing the behavior of interest.
- **Scenario discovery**: which combinations of uncertain inputs produce qualitatively different regimes.
- **Causal provenance**: which assumptions, data sources, and model versions produced a given result.

These are not decorative analytics. They are the difference between a tool that draws complexity and a tool that helps a researcher *reason* about it.

---

## 5. AI/ML components for SourceSink

### 5.1 Design principles

1. **The engine stays deterministic and pure.** AI never sits inside the integration loop. Every simulation must be reproducible from `(model, run spec, seed)`.
2. **The diagram is the source of truth.** AI produces structured model diffs, not free-form prose or opaque code.
3. **Validate before simulate.** Every AI-authored change passes parse, structural validation, dimension checks, and a smoke run before it is accepted.
4. **Every number has provenance.** Parameters, equations, and data carry a source, a confidence, and an author (human or model).
5. **AI proposes; the human disposes.** No silent edits. Reviewable diffs, undo, and an audit log.
6. **Explain in the model's vocabulary.** The tutor and explainer refer to named stocks, flows, loops, and equations, not generic systems language.
7. **Teaching mode and research mode are different products.** The same engine can support both, but the defaults, guardrails, and interfaces should differ.

### 5.2 Foundation layer

Two components unlock most of the rest.

#### A. Provenance-aware model graph

Extend the IR with optional metadata rather than changing its semantics:

```ts
interface Provenance {
  author: "human" | "ai" | "import";
  agent?: string;          // model or tool identifier
  promptHash?: string;     // reproducibility for AI-authored elements
  sources?: string[];      // DOIs, URLs, dataset ids
  confidence?: number;     // 0..1, optional
  createdAt?: string;
}

interface Element {
  // existing fields...
  provenance?: Provenance;
  annotations?: Record<string, unknown>;
}
```

Add model-level metadata for version, license, and intended use. Export it alongside XMILE so that a model carries its own audit trail. This is the single highest-leverage change for research credibility.

#### B. Model-as-tool API (MCP server)

Expose the model lifecycle as a small, typed tool surface:

- `create_model(spec)`
- `edit_model(model_id, patch)`
- `validate_model(model_id)`
- `simulate(model_id, run_spec)`
- `run_sensitivity(model_id, spec)`
- `explain(model_id, question)`
- `export_xmile(model_id)`

This lets external agents, notebooks, and the UI share one contract. It also prevents the common failure mode in which every AI feature invents its own private model representation.

### 5.3 Component catalogue

| Tier | Component | What it does | Main dependency |
|---|---|---|---|
| Foundation | Provenance-aware model graph | Makes models auditable and diffable | IR |
| Foundation | Model-as-tool / MCP API | One contract for UI, CLI, notebooks, agents | Engine |
| Assist | Structured natural-language authoring | Drafts model diffs from a description | IR + validator + LLM |
| Assist | Grounded explainer and tutor | Explains behavior from the actual graph and run | Engine + LLM |
| Assist | Literature and parameter retrieval | Finds sources and candidate parameter values | RAG + provenance |
| Inference | Calibration and parameter estimation | Fits parameters to data with bounds and priors | Engine + optimizer |
| Inference | Global sensitivity and UQ | Morris/Sobol, Monte Carlo, confidence bands | Ensemble runner |
| Inference | Surrogate modeling and optimization | Fast emulators for many-query and inverse problems | Simulation archive |
| Inference | Causal discovery | Proposes candidate structures from data | Time-series methods |
| Frontier | Hybrid ML-SD and differentiable simulation | Learns unknown rate functions inside structure | Gradient-capable engine |
| Frontier | Scenario and experiment generation | Designs informative runs and stress cases | Ensemble + optimizer |
| Frontier | Digital-twin connectors | Assimilates live data and recalibrates | Data adapters + calibration |
| Teaching | Classroom and collaboration layer | Shared sessions, exercises, dashboards | UI + provenance |

The rest of this section expands the non-obvious ones.

#### 1. Structured natural-language authoring

**What:** The user describes a system in prose; the tool proposes a set of stocks, flows, converters, connectors, and equations as a reviewable diff.

**How:** Constrain the LLM to emit a schema-validated model patch, not code. Run a repair loop: parse -> structural validation -> dimension check -> smoke simulation -> ask the model to fix only the failing part. Show the diff on the canvas with accept/reject per element.

**Why it is hard:** LLMs are good at plausible stories and bad at dimensional consistency and feedback polarity. The validator, not the model, must be the arbiter. Expect a useful success rate only after the schema and examples are strong.

**Risk:** Students may accept plausible but wrong structures. Mitigate with mandatory justification, provenance badges, and a "critique this model" step.

#### 2. Grounded explainer and tutor

**What:** Answers questions such as "Why does the population crash after the harvest policy?" by tracing the actual dependency graph and simulation.

**How:** Combine three sources: (a) the model graph, (b) the simulated trajectories, and (c) a small set of computed diagnostics (loop dominance, sensitivity, counterfactual runs). The LLM narrates those facts; it does not invent them. Every claim links to an element or a run.

**Why it matters:** This is the clearest teaching differentiator, and it is only credible if the explanations are model-grounded rather than generic.

#### 3. Calibration and parameter estimation

**What:** Fit selected parameters to observed time series, with bounds, priors, and multi-start.

**How:** Start with derivative-free methods (Nelder-Mead, pattern search) and local least squares; add global methods (differential evolution, CMA-ES) for multimodal problems. Run in a Web Worker or WASM to keep the UI responsive. Report identifiability diagnostics, not just a best fit.

**Why it matters:** Without this, SourceSink cannot support data-driven research. It is also the prerequisite for credible UQ and hybrid modeling.

#### 4. Global sensitivity and uncertainty quantification

**What:** Identify which inputs drive output variance and propagate input uncertainty into output bands.

**How:** Morris screening for many parameters; Sobol indices for the important subset; Latin hypercube or Sobol sequences for sampling; Monte Carlo ensembles for probabilistic outputs. Store ensembles as indexed runs so they can be queried and plotted.

**Why it matters:** This is the difference between a scenario tool and a research tool. It also makes teaching more honest: students see that a single trajectory is one draw from a distribution.

#### 5. Surrogate modeling and Bayesian optimization

**What:** Train a fast emulator (Gaussian process, random forest, gradient boosting, or a small neural network) on simulation ensembles, then use it for sensitivity, calibration, scenario search, and inverse design.

**How:** The engine generates a design of experiments; the surrogate is trained and validated against held-out simulations; active learning selects the next runs. Keep the surrogate explicitly labeled as an approximation with an error estimate.

**Why it matters:** Many-query questions (policy optimization, inverse problems, real-time exploration) are impractical with direct simulation. Surrogates also enable interactive "what if" exploration in the browser.

#### 6. Hybrid ML-SD and differentiable simulation

**What:** Replace an unknown rate function, closure, or behavior with a learned component while keeping the stock-flow accounting intact.

**How:** Three levels of ambition:

- **Residual correction:** an ML model corrects the output of a mechanistic rate equation.
- **Learned closure:** an ML model supplies a rate or conversion factor from state and drivers.
- **Differentiable simulation:** the integrator is written so gradients flow through it, allowing the learned component to be trained end-to-end.

**Why it matters:** This is the most scientifically distinctive direction. It also demands discipline: the learned component must be regularized, uncertainty-aware, and tested for extrapolation. A pure-TS differentiable engine is a credible research contribution; a bolted-on neural network is not.

#### 7. Causal discovery and structure proposals

**What:** Use time-series causal discovery (Granger, PCMCI+, convergent cross mapping) and sparse equation discovery (SINDy) to propose candidate links, delays, and rate forms from data.

**How:** Treat the output as **hypotheses**, never as automatic model edits. Show a ranked list of candidate links with evidence and let the researcher accept or reject them. This is a natural complement to the diagram: data suggests, the modeler decides.

**Why it matters:** It addresses the hardest part of modeling — deciding what the structure should be — without pretending that correlation is causation.

#### 8. Scenario and experiment generation

**What:** Generate informative scenarios, stress cases, and edge conditions, and choose the next simulation to run.

**How:** Combine space-filling designs, Bayesian optimization, and adversarial search for regime changes. For teaching, generate scenarios that isolate a specific loop or misconception.

**Why it matters:** Both researchers and students under-explore the input space. A tool that designs experiments makes exploration systematic.

#### 9. Literature and parameter retrieval

**What:** Retrieve candidate parameter values, equations, and model structures from the literature, with citations and provenance.

**How:** Retrieval-augmented generation over a curated corpus, constrained to return structured parameter records with source, units, and context. Never auto-fill a parameter without a visible source.

**Why it matters:** Parameter provenance is a persistent weakness of published models. A tool that makes it first-class improves reproducibility.

#### 10. Classroom and collaboration layer

**What:** Shared model sessions, assignment templates, student-model comparison, and instructor dashboards.

**How:** A lightweight server with model versioning, anonymized structural signatures, and per-student provenance. Keep student data local or institution-controlled by default.

**Why it matters:** This is where a free, open teaching tool can outperform commercial platforms, which are optimized for individual analysts rather than classrooms.

#### 11. Digital-twin connectors

**What:** Connect a model to live or periodic data, update states, and recalibrate online.

**How:** Adapters for CSV, databases, APIs, and time-series stores; state estimation (Kalman-style or ensemble-based); scheduled recalibration; drift detection.

**Why it matters:** Water utilities, infrastructure operators, and environmental agencies increasingly want models that stay current, not models that are run once for a report.

### 5.4 What not to build

- **An LLM in the integration loop.** It destroys determinism and reproducibility.
- **A chat-first interface that hides the diagram.** It undermines the core pedagogical and scientific value.
- **Automatic equation rewriting without review.** Provenance and trust collapse.
- **A generic "AI assistant" with no model tools.** It will hallucinate structures that do not validate.
- **Proprietary model formats.** XMILE and open serialization are strategic assets.
- **A surrogate presented as the model.** Always label approximations and report their error.

---

## 6. Architecture and integration

### 6.1 Package layout

Respect the existing dependency rule: edges point inward toward `@sourcesink/model`. Proposed additions:

```
src/
  model/        IR + function catalog (extended with provenance, scenarios)
  engine/       pure simulation (extended with ensembles, arrays, gradients)
  analysis/     calibration, sensitivity, UQ, loop dominance, surrogates
  ai/           provider-agnostic LLM client, schemas, prompt templates, RAG
  mcp/          model-as-tool API for agents and notebooks
  learn/        tutoring, exercises, assessment, classroom logic
  ui/           editor and new panels (assistant, calibration, uncertainty)
  cli/          headless run, sweep, fit, explain
```

Dependency direction:

```
ui / cli / mcp / learn
        |
      ai / analysis
        |
      engine
        |
      model
```

`ai` may depend on `model` and `analysis`, but never on the engine's internals. `engine` must not depend on `ai`.

### 6.2 IR extensions

Add optional, backward-compatible fields:

```ts
interface Model {
  // existing...
  metadata?: {
    version?: string;
    license?: string;
    intendedUse?: string;
    provenance?: Provenance;
  };
  scenarios?: Scenario[];
}

interface Scenario {
  id: string;
  name: string;
  overrides: Record<string, string | number>;
  run?: Partial<RunSpec>;
}

interface ParameterSpec {
  element: string;
  min?: number;
  max?: number;
  prior?: Distribution;
  fixed?: boolean;
}
```

Distributions, calibration targets, and sensitivity specs should live in `analysis`, not in the core IR, unless XMILE needs to carry them. Keep the core small.

### 6.3 Engine extensions

The engine should grow along four axes, each with tests:

1. **Correctness:** RK2/RK4/adaptive; array/subscript simulation; unit-aware validation.
2. **Throughput:** ensemble runs, scenario batches, seeded RNG streams, worker/WASM execution.
3. **Differentiability:** finite-difference gradients first; autodiff or adjoint methods later.
4. **Inspectability:** per-loop contribution traces, state checkpoints, and run metadata.

A minimal ensemble interface:

```ts
interface EnsembleSpec {
  base: Model;
  samples: Array<Record<string, number>>; // parameter overrides
  seeds?: number[];
  parallel?: number;
}

function simulateEnsemble(spec: EnsembleSpec): EnsembleResult;
```

This one function unlocks calibration, sensitivity, UQ, and surrogate training.

### 6.4 CLI and UI surfaces

Proposed commands:

```bash
sourcesink run model.xmile
sourcesink sweep model.xmile --param K=0.1:1.0:20 --param alpha=0:1:10
sourcesink fit model.xmile --data obs.csv --param K --param alpha
sourcesink sensitivity model.xmile --method sobol --params K,alpha,beta
sourcesink explain model.xmile --question "why the overshoot?"
sourcesink ask "build a model of reservoir sedimentation with two grain sizes"
```

Proposed UI surfaces:

- **Assistant panel** with proposed model diffs, not free text.
- **Why? button** on any series: opens a grounded explanation with links to elements and runs.
- **Calibration panel**: parameter bounds, data upload, fit diagnostics, residual plots.
- **Uncertainty panel**: input distributions, sensitivity ranking, output bands.
- **Scenario comparison**: overlay trajectories from multiple scenarios with provenance.
- **Provenance badges** on AI-authored or imported elements.
- **Teaching mode**: prediction capture, hints that escalate, and explanation withholding.

### 6.5 MCP tool surface

Keep the tool surface small and typed. Suggested tools:

| Tool | Input | Output |
|---|---|---|
| `model.create` | name, description | model id |
| `model.patch` | model id, JSON patch | validation result |
| `model.validate` | model id | errors, warnings |
| `model.simulate` | model id, run spec, seed | series |
| `model.ensemble` | model id, ensemble spec | summary statistics |
| `model.sensitivity` | model id, parameter list | indices |
| `model.calibrate` | model id, data, parameter specs | fitted params, diagnostics |
| `model.explain` | model id, question | grounded explanation |
| `model.export` | model id, format | XMILE or JSON |

The MCP layer should enforce validation and provenance on every write. It is the natural integration point for coding agents, notebooks, and future classroom tooling.

### 6.6 Validation and safety

AI-authored changes must pass a gauntlet:

1. **Schema validation** of the model patch.
2. **Parse validation** of every equation.
3. **Structural validation**: names, connectors, flow wiring, dimension consistency.
4. **Semantic smoke test**: a short run that must complete without NaN or exceptions.
5. **Diff review**: the user sees exactly what changed.
6. **Provenance stamp**: author, agent, prompt hash, timestamp.

Store rejected patches and validation failures as evaluation data. They are the raw material for improving the authoring layer.

---

## 7. Phased roadmap

Effort estimates are rough and assume one focused developer plus agent assistance.

| Phase | Duration | Deliverables | Why now |
|---|---|---|---|
| **A. Core credibility** | 1-2 months | Arrays/subscripts simulated; RK2/RK4/adaptive; scenario runner; provenance fields; model diff format; MCP server; ensemble API | Without these, later AI work has nothing trustworthy to act on |
| **B. Research analysis** | 2-4 months | Calibration; Morris/Sobol sensitivity; Monte Carlo UQ; ensemble storage; uncertainty plots; loop dominance diagnostics | Turns SourceSink into a research-capable tool |
| **C. Teaching assistant** | 2-3 months | Grounded explainer; Socratic tutor; predict-then-run; exercise generator; misconception signatures; classroom sessions | Highest pedagogical differentiation, builds on A and B |
| **D. Generative authoring** | 3-5 months | Natural-language model diffs; retrieval over examples and literature; repair loop; evaluation benchmark | Only credible after schema, validation, and examples are strong |
| **E. Hybrid and frontier** | 6-12+ months | Differentiable simulation; learned closures; causal discovery; surrogate optimization; digital-twin connectors | Distinctive research contribution; highest risk |

A sensible sequence is A -> B -> C, with D prototyped in parallel once A is stable. E should be treated as a research program, not a feature sprint.

---

## 8. Evaluation: how we will know it works

### For the authoring and AI layer

- **Structural validity rate:** fraction of AI-generated models that pass validation and smoke simulation.
- **Repair efficiency:** number of repair iterations needed to reach a valid model.
- **Equation correctness:** fraction of equations that match a reference model or pass dimensional checks.
- **Hallucination rate:** references to nonexistent elements, parameters, or sources.
- **Human acceptance rate:** fraction of proposed diffs accepted without edits.

### For the analysis layer

- **Parameter recovery:** can calibration recover known parameters from synthetic data?
- **Sensitivity ranking accuracy:** do Sobol rankings match analytic or reference results?
- **Surrogate error:** out-of-sample error versus direct simulation.
- **Identifiability diagnostics:** are weakly identified parameters flagged correctly?

### For the teaching layer

- **Learning gains:** pre/post assessment versus a control section.
- **Misconception reduction:** change in structural-error signatures.
- **Prediction calibration:** do students' predictions improve over the term?
- **Transfer:** can students diagnose a novel model they did not build?
- **Equity:** does the tool reduce or widen gaps between prepared and unprepared students?

### For the research layer

- **Reproducibility:** can an independent user reproduce a published result from the model file and provenance?
- **Uncertainty coverage:** do reported bands contain the observations at the claimed rate?
- **Generalization:** does a hybrid model trained on one period predict another?
- **Decision value:** does the analysis change a stated decision or policy recommendation?

---

## 9. Risks and guardrails

| Risk | Why it matters | Guardrail |
|---|---|---|
| **Automation bias** | Students and researchers accept plausible AI models uncritically | Mandatory diff review; provenance badges; critique exercises |
| **Hallucinated structure** | LLMs invent links and equations that look right | Schema + validation + smoke test; never auto-accept |
| **Loss of mathematical grounding** | Convenience erodes understanding of integration and feedback | Prediction-first pedagogy; derivations remain visible |
| **Opaque surrogates** | Fast approximations masquerade as the model | Label surrogates; report out-of-sample error; keep the engine authoritative |
| **Overfitting hybrid models** | Learned closures fit noise and extrapolate badly | Regularization; held-out periods; uncertainty estimates; structural checks |
| **Privacy and surveillance** | Classroom telemetry can harm students | Local-first defaults; anonymization; institutional control |
| **Vendor lock-in** | Cloud AI and proprietary formats undermine openness | XMILE as canonical format; provider-agnostic AI adapter; offline mode |
| **Maintenance burden** | AI features decay as models and APIs change | Evaluation harness; prompt versioning; small, typed tool surface |
| **Scope creep** | Trying to match every commercial feature dilutes the mission | Prioritize teaching + research differentiation, not feature parity |

---

## 10. Immediate next steps

1. **Simulate arrays.** The IR already has dimensions and array specs; the engine does not use them. This is the largest correctness gap.
2. **Add RK2/RK4 and adaptive stepping.** The `RunSpec` already advertises the methods and the UI marks them "coming soon."
3. **Add `simulateEnsemble` and seeded RNG streams.** This is the single function that unlocks calibration, sensitivity, UQ, and surrogates.
4. **Add provenance and model metadata to the IR and XMILE export.** Do this before generating any AI-authored content.
5. **Define the model patch format and validation gauntlet.** AI authoring is only safe if the diff-and-validate path exists first.
6. **Expose the MCP tool surface.** Start with `validate`, `simulate`, and `export`.
7. **Build one narrow, excellent AI feature:** a grounded explainer that answers "why did this trajectory do that?" using the model graph and run output. Do not start with full model generation.
8. **Create an evaluation corpus:** 20-50 small models with known behavior, plus a set of deliberately broken models for repair tests.

The order matters. Provenance and validation before generation; analysis before tutoring; one excellent grounded feature before a broad assistant.

---

## Appendix A: Method families worth adopting

**Calibration and optimization:** Nelder-Mead, pattern search, Levenberg-Marquardt, differential evolution, CMA-ES, Bayesian optimization.

**Sensitivity and uncertainty:** Morris screening, Sobol variance decomposition, Latin hypercube and Sobol sampling, Monte Carlo ensembles, Gaussian process emulation.

**Causal and structure discovery:** Granger causality, PCMCI+, convergent cross mapping, sparse identification of nonlinear dynamics (SINDy), regime-shift detection.

**Hybrid modeling:** residual correction, learned closures, neural ordinary differential equations, universal differential equations, differentiable simulation.

**Explanation:** loop dominance analysis, eigenvalue elasticity, counterfactual simulation, Shapley-style decomposition of run outcomes, provenance graphs.

**Teaching and assessment:** predict-observe-explain, model elicitation, misconception inventories, structural similarity clustering, learning analytics.

Formal citations and a literature review should be added before this document is used in a proposal or publication.

## Appendix B: Reading the current code

- `src/model/src/index.ts` — the IR and validation.
- `src/model/src/functions.ts` — the built-in function catalog and time-step semantics.
- `src/engine/src/simulate.ts` — the integration and evaluation core.
- `src/engine/src/builtins.ts` — stateful function implementations.
- `src/engine/src/expr.ts` — the equation parser and evaluator.
- `src/xmile/` — XMILE reader/writer.
- `src/legacy/` — `.stm`/`.itm` importer.
- `src/ui/src/App.tsx` — the application shell and results drawer.
- `docs/architecture.md`: project structure and constraints.

---

*This document is a working strategy, not a specification. It should be revised as the engine gains arrays, ensembles, and calibration, and as the AI evaluation results come in.*
