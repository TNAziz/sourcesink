# Sub-agent orchestration — model routing and cost

The lead session (Claude Opus) owns contracts, core engine work and review.
Bounded, well-specified tasks go to OpenCode agents on OpenRouter, each in its
own herdr tab, working against a written brief and a shared contract
(`src/ui/src/state/store.ts`, `src/ui/src/theme.css`, per-folder ownership).

## Routing (prices: OpenRouter list, USD per 1M tokens in / out, 2026-10-17)

| Tier | Model | Price | Use for |
|---|---|---|---|
| Lead | Claude Opus 5.5 | 4 / 20 | Contracts, engine semantics, review, integration |
| Taste / large UI | z-ai/glm-5.3 | 0.08 / 4.80 | The visible, design-heavy surface (canvas, app shell) |
| Workhorse | deepseek/deepseek-v4.1-flash | 0.06 / 0.14 | Forms, file I/O, shortcuts, pure logic + tests |
| Workhorse (alt) | z-ai/glm-5.3-flash | 0.05 / 0.20 | Same tier; used for charts/tables |

Agent sessions are input-heavy (files re-read on every turn), so a low *input*
price matters more than the output price. GLM-5.3's input is near-Flash
cheap, which is why it beats similarly rated models with higher input prices.

## Observed (UI build, 2026-10-17)

| Agent | Model | Wall time | Cost | Result |
|---|---|---|---|---|
| canvas + shell | GLM-5.3 | 11 min + 2 polish rounds | $2.12 | Strong design; layout bugs fixed in review rounds |
| results | GLM-5.3 Flash | 9 min + 2 polish rounds | $0.30 | Chart collapsed to 0px; fixed on request |
| inspector | DeepSeek V4.1 Flash | 4 min | $0.05 | Clean, tested, accepted as-is |
| files/examples | DeepSeek V4.1 Flash | 6 min | $0.04 | Clean, tested, accepted as-is |

Total sub-agent spend: about $2.50 for roughly 4,000 lines of UI code and 130 UI tests.

What made cheap models succeed: a precise brief, one owner per folder, a
pre-written state contract and design tokens, "pure logic in `.ts` + tests",
and a mandatory `tsc` + `vitest` gate before reporting. The lead then checks
the running app with screenshots, since passing tests did not catch the
layout bugs.
