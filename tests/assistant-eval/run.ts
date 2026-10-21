/**
 * SourceSink — assistant round-trip evaluation (run on demand; real model calls).
 *
 * Builds each corpus model from a conversation: the assistant runs with
 * `runTurn` and every proposal is auto-accepted; a scripted user, guided by the
 * story and the original model's description, answers its questions and says
 * DONE when the model is complete. The rebuilt model is then compared with the
 * original (see compare.ts) and a Markdown report is written.
 *
 * Not part of the test suite: it calls OpenCode/OpenRouter and costs money.
 * Usage: npm run eval:assistant -- [--models a.xmile,b.xmile]
 *          [--assistant-model ID] [--user-model ID] [--max-turns N] [--out report.md]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emptyModel, type Model } from "@sourcesink/model";
import {
  newConversation,
  runTurn,
  type Conversation,
} from "@sourcesink/assistant";
import { createOpencodeComplete, DEFAULT_MODEL } from "@sourcesink/assistant/node";
import { describeModel } from "@sourcesink/explain";
import { readXmile } from "@sourcesink/xmile";

import { compareModels, type Comparison } from "./compare.js";
import { isCompletedReply, scriptedUserMessages } from "./user.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(HERE, "../corpus/models");

/** Simple corpus models used when `--models` is absent. */
const DEFAULT_MODELS = [
  "linear-reservoir-fill.xmile",
  "exponential-algal-growth.xmile",
  "aquifer-decay.xmile",
  "goal-seeking-reservoir.xmile",
  "logistic-wetland-reeds.xmile",
];

interface CliOptions {
  models: string[];
  assistantModel: string;
  userModel: string;
  maxTurns: number;
  out: string;
}

interface TranscriptEntry {
  speaker: "assistant" | "user";
  text: string;
  note?: string;
}

interface ModelRun {
  file: string;
  turns: number;
  cost?: number;
  comparison?: Comparison;
  stoppedBy: "done" | "max-turns" | "empty-reply" | "error";
  error?: string;
  transcript: TranscriptEntry[];
}

const USAGE = `Usage: npm run eval:assistant -- [options]

Options:
  --models a.xmile,b.xmile   Corpus models to rebuild (default: five simple ones)
  --assistant-model ID       Assistant language model (default: ${DEFAULT_MODEL})
  --user-model ID            Scripted-user language model (default: ${DEFAULT_MODEL})
  --max-turns N              Stop after N assistant turns (default: 10)
  --out PATH                 Markdown report path (default: tests/assistant-eval/report.md)
  --help                     Show this help`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    models: DEFAULT_MODELS,
    assistantModel: DEFAULT_MODEL,
    userModel: DEFAULT_MODEL,
    maxTurns: 10,
    out: path.join(HERE, "report.md"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      i += 1;
      return next;
    };

    switch (flag) {
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      case "--models": {
        const names = value()
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
        if (names.length === 0) throw new Error("--models needs at least one file");
        options.models = names;
        break;
      }
      case "--assistant-model":
        options.assistantModel = value();
        break;
      case "--user-model":
        options.userModel = value();
        break;
      case "--max-turns": {
        const raw = value();
        const turns = Number(raw);
        if (!Number.isInteger(turns) || turns <= 0) {
          throw new Error(`--max-turns must be a positive integer, got '${raw}'`);
        }
        options.maxTurns = turns;
        break;
      }
      case "--out":
        options.out = path.resolve(value());
        break;
      default:
        throw new Error(`unknown option '${flag}'`);
    }
  }
  return options;
}

function resolveModelPath(file: string): string {
  if (path.isAbsolute(file)) return file;
  const cwd = path.resolve(file);
  if (existsSync(cwd)) return cwd;
  return path.resolve(MODELS_DIR, file);
}

function loadModel(file: string): Model {
  const target = resolveModelPath(file);
  if (!existsSync(target)) throw new Error(`model not found: ${target}`);
  return readXmile(readFileSync(target, "utf8"));
}

/** Running USD total; `seen` records whether any provider reported a cost. */
interface CostMeter {
  total: number;
  seen: boolean;
}

function addCost(meter: CostMeter, cost: number | undefined): void {
  if (cost === undefined) return;
  meter.total += cost;
  meter.seen = true;
}

function formatCost(meter: CostMeter | undefined): string {
  if (!meter || !meter.seen) return "n/a";
  return `$${meter.total.toFixed(4)}`;
}

function formatNrmse(value: number): string {
  return Number.isNaN(value) ? "did not simulate" : value.toFixed(4);
}

/** Rebuild one model through a conversation. */
async function evaluateModel(
  file: string,
  options: CliOptions,
  assistantComplete: ReturnType<typeof createOpencodeComplete>,
  userComplete: ReturnType<typeof createOpencodeComplete>,
): Promise<ModelRun> {
  const original = loadModel(file);
  const story = storyFor(original, file);
  const description = describeModel(original).markdown;
  const cost: CostMeter = { total: 0, seen: false };
  const transcript: TranscriptEntry[] = [];

  let rebuilt = emptyModel();
  let conversation: Conversation = newConversation();
  let userText = story;
  let turns = 0;
  let stoppedBy: ModelRun["stoppedBy"] = "max-turns";

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    const result = await runTurn(rebuilt, conversation, userText, assistantComplete, {
      model: options.assistantModel,
    });
    conversation = result.conversation;
    turns = turn;
    addCost(cost, result.cost);
    if (result.proposal) rebuilt = result.proposal.model;

    const assistantText =
      conversation.history[conversation.history.length - 1]?.content ?? result.turn.message;
    transcript.push({
      speaker: "assistant",
      text: assistantText,
      ...(result.gaveUp ? { note: "the assistant gave up on this turn" } : {}),
    });

    const reply = await userComplete({
      model: options.userModel,
      messages: scriptedUserMessages(story, description, conversation.history),
    });
    addCost(cost, reply.cost);
    const replyText = reply.text.trim();
    transcript.push({ speaker: "user", text: replyText });

    if (isCompletedReply(replyText)) {
      stoppedBy = "done";
      break;
    }
    if (replyText.length === 0) {
      stoppedBy = "empty-reply";
      break;
    }
    userText = replyText;
  }

  const comparison = compareModels(original, rebuilt);
  return {
    file,
    turns,
    ...(cost.seen ? { cost: cost.total } : {}),
    comparison,
    stoppedBy,
    transcript,
  };
}

/** The manifest story when we have one (the five defaults are all in it). */
function storyFor(model: Model, file: string): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(path.resolve(HERE, "../corpus/manifest.json"), "utf8"),
    );
    if (Array.isArray(manifest)) {
      for (const entry of manifest) {
        if (typeof entry !== "object" || entry === null) continue;
        const candidate = entry as { file?: unknown; story?: unknown };
        if (typeof candidate.file !== "string" || typeof candidate.story !== "string") continue;
        if (path.basename(candidate.file) === path.basename(file)) return candidate.story;
      }
    }
  } catch {
    // Fall back to the model's own documentation below.
  }
  return model.documentation ?? `A system-dynamics model named ${model.name}.`;
}

function comparisonSection(comparison: Comparison): string {
  const rows = [
    `| Measure | Matched | Expected | Extra |`,
    `|---|---:|---:|---:|`,
    `| Stocks | ${comparison.stocks.matched} | ${comparison.stocks.expected} | ${comparison.stocks.extra} |`,
    `| Flows | ${comparison.flows.matched} | ${comparison.flows.expected} | ${comparison.flows.extra} |`,
    `| Feedback loops | ${comparison.loops.matched} | ${comparison.loops.expected} | — |`,
  ];
  const nrmseNames = Object.keys(comparison.nrmse).sort();
  const nrmseRows =
    nrmseNames.length === 0
      ? []
      : [
          "",
          `| Stock | NRMSE |`,
          `|---|---:|`,
          ...nrmseNames.map((name) => `| ${name} | ${formatNrmse(comparison.nrmse[name])} |`),
        ];
  return [...rows, ...nrmseRows].join("\n");
}

function transcriptSection(entries: TranscriptEntry[]): string {
  const lines = entries.map((entry) =>
    [
      `**${entry.speaker === "assistant" ? "Assistant" : "User"}:**`,
      "",
      entry.note ? `(${entry.note})` : "",
      entry.text,
      "",
    ]
      .filter((part) => part.length > 0)
      .join("\n"),
  );
  return [
    `<details>`,
    `<summary>Transcript (${entries.length} messages)</summary>`,
    "",
    ...lines,
    `</details>`,
  ].join("\n");
}

function modelSection(run: ModelRun): string {
  const meter: CostMeter = { total: run.cost ?? 0, seen: run.cost !== undefined };
  const outcome =
    run.error !== undefined
      ? `**ERROR** — ${run.error}`
      : run.comparison?.pass
        ? "**PASS**"
        : "**FAIL**";
  const parts = [
    `## ${run.file}`,
    "",
    outcome,
    "",
    `- Turns used: ${run.turns}`,
    `- Cost: ${formatCost(meter)}`,
    `- Stopped by: ${run.stoppedBy}`,
  ];
  if (run.comparison) {
    parts.push("", comparisonSection(run.comparison));
  }
  parts.push("", transcriptSection(run.transcript));
  return parts.join("\n");
}

function report(runs: ModelRun[], options: CliOptions): string {
  const cost: CostMeter = { total: 0, seen: false };
  for (const run of runs) addCost(cost, run.cost);
  const passed = runs.filter((run) => run.comparison?.pass && run.error === undefined).length;
  const totalTurns = runs.reduce((sum, run) => sum + run.turns, 0);

  const summaryRows = runs.map((run) => {
    const status =
      run.error !== undefined ? "error" : run.comparison?.pass ? "pass" : "fail";
    const runCost: CostMeter = { total: run.cost ?? 0, seen: run.cost !== undefined };
    return `| ${run.file} | ${run.turns} | ${formatCost(runCost)} | ${status} |`;
  });

  return [
    `# Assistant round-trip evaluation`,
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Assistant model: \`${options.assistantModel}\``,
    `- Scripted-user model: \`${options.userModel}\``,
    `- Max turns: ${options.maxTurns}`,
    "",
    `## Summary`,
    "",
    `| Model | Turns | Cost | Result |`,
    `|---|---:|---:|---|`,
    ...summaryRows,
    `| **All ${runs.length}** | ${totalTurns} | ${formatCost(cost)} | ${passed}/${runs.length} passed |`,
    "",
    ...runs.map((run) => [modelSection(run), ""]).flat(),
    `## Totals`,
    "",
    `- Models: ${runs.length}`,
    `- Passed: ${passed}`,
    `- Failed: ${runs.length - passed}`,
    `- Assistant turns: ${totalTurns}`,
    `- Total cost: ${formatCost(cost)}`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const assistantComplete = createOpencodeComplete();
  const userComplete = createOpencodeComplete();
  const runs: ModelRun[] = [];

  for (const file of options.models) {
    process.stdout.write(`${file}: running... `);
    let run: ModelRun;
    try {
      run = await evaluateModel(file, options, assistantComplete, userComplete);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      run = {
        file,
        turns: 0,
        stoppedBy: "error",
        error: message,
        transcript: [{ speaker: "user", text: `(harness error: ${message})` }],
      };
    }
    runs.push(run);

    const status =
      run.error !== undefined ? "ERROR" : run.comparison?.pass ? "PASS" : "FAIL";
    const meter: CostMeter = { total: run.cost ?? 0, seen: run.cost !== undefined };
    const detail =
      run.error !== undefined
        ? run.error
        : `${run.turns} turn${run.turns === 1 ? "" : "s"}, ${formatCost(meter)}`;
    console.log(`${status} (${detail})`);
  }

  const markdown = report(runs, options);
  writeFileSync(options.out, markdown, "utf8");
  console.log(`report written to ${options.out}`);
}

await main();
