# Modeling assistant: plan

**Status:** built (2026-10-18/19). Corresponds to `docs/FUTURE.md` §5.3 item 1
("structured natural-language authoring") and the grounded explainer/tutor.

What exists now, beyond the plan below:

- **Grounded answers.** A reply may request up to three simulations
  (`runs`: the current model, the proposal, or what-if overrides, with
  thresholds). SourceSink runs them locally, turns the results into plain
  facts (peaks, levels, threshold crossings interpolated between saved points,
  comparisons with the base run), sends the facts back, and the model answers
  from them. The panel shows each run as a card with its facts and a chart.
- **Unit checking.** `@sourcesink/units` infers equation units and checks
  flows against their stocks and the model's time unit. The gauntlet reports
  findings as warnings; for an AI patch, warnings on elements it touched get
  one repair round. Also `sourcesink units <model>` and inspector warnings.
- **Speed.** One long-lived, password-protected `opencode serve` on 127.0.0.1
  replaces a CLI start per call (about 0.6–0.9 s per call instead of ~8.5 s of
  start-up), and replies stream into the panel as they are written.
- **Evaluation.** `npm run eval:assistant` rebuilds corpus models through a
  scripted conversation; the five default models pass (about $0.02 total).

## Goal

A user describes, in ordinary language, a system they want to understand. The
assistant interviews them with follow-up questions, drafts the model as a set of
reviewable changes, and then points them to the features that answer their
question (run, scenarios, calibrate, sensitivity, uncertainty, describe).

Two rules hold throughout:

1. **The validator is the arbiter, not the language model.** The assistant can
   only change a model by emitting a `@sourcesink/patch` patch. Every patch goes
   through the existing gauntlet (schema, apply, parse, structure, smoke run)
   before the user sees it. Failures are sent back to the model to repair, with
   a retry limit.
2. **The user approves every change.** Proposed patches appear as a diff with
   per-element accept/reject. Accepted changes are one undo step and carry
   provenance `author: "ai"` with the model id in `agent`, so they show the
   existing AI badge.

## How a conversation runs

The assistant works through a fixed interview, but skips stages the user has
already answered and returns to earlier stages when something new comes up.

| Stage | What it asks | Output |
|---|---|---|
| 1. Question | What do you want to know? Over what time span? | Model name, run length, time units |
| 2. Boundary | What is inside the system, and what is held fixed? | A list of candidate stocks and exogenous inputs |
| 3. Stocks | What accumulates? In what units? Starting amount? | `add stock` ops |
| 4. Flows | What fills and drains each stock, and at what rate? | `add flow` and `wire` ops, rate equations |
| 5. Feedback | Does any stock change its own inflow or outflow? | Connectors; loops confirmed against `@sourcesink/explain` |
| 6. Numbers | Parameter values, ranges, and sources | Converters with units and documentation |
| 7. Data and next steps | Do you have observations? What are you unsure of? | Feature suggestions (below) |

After each patch is applied, the assistant reads back the structural description
from `@sourcesink/explain` ("BOD is drained by deoxygenation, which depends on kd
and BOD...") so the user can catch misunderstandings in plain words rather than
equations. This is the model-narrative idea used as a check.

### Leading the user to features

Each turn may include suggestions, which render as buttons that open the
relevant panel already filled in:

- has observations → **Calibrate** with the CSV and candidate parameters
- unsure of several parameter values → **Sensitivity** (Morris first)
- wants a range of outcomes → **Uncertainty**
- "what if" questions → **Scenarios**
- wants to explain the model to someone → **Describe**

Suggestions come from a small rule table plus the model's own judgment, so the
obvious cases work even with a weak model.

## Turn format

Every model reply must be one JSON object, validated with a schema:

```json
{
  "message": "Plain-language reply shown to the user.",
  "questions": ["At most three follow-up questions."],
  "patch": { "ops": [ ... ] },
  "suggestions": [{ "feature": "calibrate", "reason": "You mentioned DO field data." }],
  "stage": "flows"
}
```

`patch` and `suggestions` are optional. A reply that does not parse, or a patch
that fails the gauntlet, triggers a repair request naming the exact failure
("equation for reaeration references DO_deficitt, which does not exist"). After
three failed repairs the assistant tells the user what it could not do and keeps
the model unchanged.

Each request sends: a system prompt with the patch grammar, the equation dialect
and two worked examples; the current model as compact JSON plus its structural
description; and the conversation so far. The conversation and model are resent
each turn, so turns are stateless and reproducible.

## Where the language model comes from

LLM calls go through OpenCode with OpenRouter, not a hard-wired vendor:
`opencode run -m openrouter/<model> --format json`. The user picks the model
from a list built by `opencode models openrouter`. Default:
`openrouter/deepseek/deepseek-v4.1-flash-1017`.

- **Desktop app:** the Electron main process spawns `opencode` and exposes a
  single `assistant.complete` IPC call. No key is stored by SourceSink.
- **Browser (`npm start`):** a Vite dev-server middleware provides the same
  endpoint locally. The static web build has no assistant unless the user
  supplies an endpoint.
- **MCP:** external agents (Claude Code, OpenCode itself) already reach the same
  model through the existing MCP tools, so nothing new is needed there.

If `opencode` is missing or not signed in, the panel says so and explains how to
set it up instead of failing silently.

## Work packages

| # | Package | Contents | Tests |
|---|---|---|---|
| 1 | `src/assistant` (new, pure TypeScript) | Turn schema, prompt builder, interview stage tracker, repair loop over the gauntlet, suggestion rules. The LLM is an injected `complete(messages)` function | Fake LLM scripts: good patch, broken patch repaired, broken patch abandoned, stage skipping |
| 2 | LLM bridge | Desktop IPC + Vite middleware around `opencode run`; model list; timeout and cancel | Spawn stubbed; JSON event parsing |
| 3 | Assistant panel (UI) | Chat, model picker, patch diff with per-element accept, suggestion buttons that open Analyze/Scenarios/Describe pre-filled | Render smoke tests; accept/reject reducer |
| 4 | Evaluation harness | Round trip on `tests/corpus`: describe a corpus model in words, let a scripted "user" answer the assistant's questions from that description, compare the rebuilt model (stocks, flows, loops, and simulated output) to the original | Pass rate per model; run on demand, not in the default test suite, since it calls a real model |

Packages 1 and 2 can be written in parallel by agents; 3 depends on 1's types;
4 depends on 1 and 2. As in Phases A and B, OpenCode agents would do the bulk
work in separate worktrees, with every merge reviewed and the full test gate
run before commit.

## How we will know it works

- On the corpus round trip, the rebuilt model has the same stocks, flows and
  feedback loops as the original for most models, and its simulation matches
  within tolerance for the simple ones (decay, logistic, Streeter–Phelps).
- No patch reaches the user without passing the gauntlet (enforced in code and
  covered by tests).
- A first-time user can go from "I want to model oxygen in a river below a
  treatment plant" to a running, calibrated model without opening the equation
  editor.

## Out of scope for the first version

Voice input, literature search for parameter values, multi-user sessions, and
automatic causal discovery from data. Each is a reasonable follow-on.
