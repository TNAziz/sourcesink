/**
 * SourceSink — grounded, deterministic model explanation.
 *
 * The description is assembled only from the model graph and the engine's
 * numeric polarities. It names every element and accounts for every causal
 * link; `coverage` verifies that claim mechanically.
 */

import type { Model } from "@sourcesink/model";
import { causalLinks, graphElements, type Link } from "./links.js";
import { findLoops, type Loop } from "./loops.js";

export interface ModelDescription {
  /** Markdown, sectioned: Overview; Stocks; Flows; Converters and graph
   * functions; Feedback loops; Time settings. Uses the model's own names. */
  markdown: string;
  /** Every element and every link mentioned, for the completeness check. */
  mentions: { elements: string[]; links: Array<{ from: string; to: string }> };
}

interface LinkPair {
  from: string;
  to: string;
}

/** Underscores become spaces for prose; the exact name is kept in `mentions`. */
function display(name: string): string {
  return name.replace(/_/g, " ");
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function linkKey(link: LinkPair): string {
  return `${link.from}\u0000${link.to}`;
}

function uniqueLinks(links: Link[]): LinkPair[] {
  const seen = new Set<string>();
  const out: LinkPair[] = [];
  for (const link of links) {
    const pair = { from: link.from, to: link.to };
    const key = linkKey(pair);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function describeStocks(model: Model, links: Link[]): string {
  if (model.stocks.length === 0) return "This model has no stocks.";
  const lines: string[] = [];
  for (const stock of model.stocks) {
    const filled = links
      .filter((l) => l.kind === "flow-into-stock" && l.to === stock.name)
      .map((l) => display(l.from));
    const drained = links
      .filter((l) => l.kind === "flow-out-of-stock" && l.to === stock.name)
      .map((l) => display(l.from));

    let text = `- **${display(stock.name)}**`;
    if (stock.units) text += ` (in ${display(stock.units)})`;
    text += ` starts at \`${display(stock.equation)}\``;

    const motion: string[] = [];
    if (filled.length > 0) motion.push(`is filled by ${formatList(filled.map((n) => `*${n}*`))}`);
    if (drained.length > 0) motion.push(`is drained by ${formatList(drained.map((n) => `*${n}*`))}`);
    if (motion.length > 0) text += `. It ${motion.join(" and ")}.`;
    else text += ". Nothing fills or drains it.";
    lines.push(text);
  }
  return lines.join("\n");
}

function describeFlows(model: Model, links: Link[]): string {
  if (model.flows.length === 0) return "This model has no flows.";
  const lines: string[] = [];
  for (const flow of model.flows) {
    const deps = links
      .filter((l) => l.kind === "information" && l.to === flow.name)
      .map((l) => display(l.from));

    let text = `- **${display(flow.name)}**`;
    if (flow.units) text += ` (in ${display(flow.units)})`;
    text += ` is given by \`${display(flow.equation)}\`.`;
    if (deps.length > 0) {
      text += ` It depends on ${formatList(deps.map((n) => `*${n}*`))}.`;
    } else {
      text += " It does not depend on another element.";
    }
    if (flow.biflow) text += " It is a biflow, so it can run in either direction.";
    if (flow.leak) text += " It is a conveyor leak.";
    lines.push(text);
  }
  return lines.join("\n");
}

function describeConverters(model: Model, links: Link[]): string {
  const parts: string[] = [];
  for (const converter of model.converters) {
    const deps = links
      .filter((l) => l.kind === "information" && l.to === converter.name)
      .map((l) => display(l.from));

    let text = `- **${display(converter.name)}**`;
    if (converter.units) text += ` (in ${display(converter.units)})`;
    text += ` is given by \`${display(converter.equation)}\`.`;
    if (deps.length > 0) {
      text += ` It is computed from ${formatList(deps.map((n) => `*${n}*`))}.`;
    } else if (NUMBER_RE.test(converter.equation.trim())) {
      text += " It is a constant.";
    } else {
      text += " It is set directly by its equation.";
    }
    parts.push(text);
  }

  for (const gf of model.graphFunctions) {
    const input = model.connectors.find(
      (c) => c.to.trim().toLowerCase().replace(/[\s_]+/g, "_") ===
        gf.name.trim().toLowerCase().replace(/[\s_]+/g, "_"),
    );
    const xs = gf.points.map((p) => p.x);
    const range = xs.length > 0 ? ` over x = ${Math.min(...xs)} to ${Math.max(...xs)}` : "";
    let text = `- **${display(gf.name)}** is a graph function with ${gf.points.length} point${gf.points.length === 1 ? "" : "s"}${range}`;
    text += `, using ${gf.interpolation} interpolation and ${gf.extrapolation} extrapolation.`;
    if (input) text += ` Its input comes from *${display(input.from)}*.`;
    else text += " It has no input connector.";
    parts.push(text);
  }

  if (parts.length === 0) return "This model has no converters or graph functions.";
  return parts.join("\n");
}

function describeLoops(model: Model): string {
  const { loops, truncated } = findLoops(model);
  if (loops.length === 0) return "No feedback loops were found.";
  const lines = loops.map((loop: Loop) => {
    const chain = [...loop.elements, loop.elements[0]].map((n) => display(n)).join(" → ");
    return `- **${loop.id} — ${loop.type}:** ${chain}.`;
  });
  if (truncated) lines.push("\n(Only the first 500 loops are listed.)");
  return lines.join("\n");
}

function describeRun(model: Model): string {
  const { run } = model;
  const unit = run.timeUnits ? ` ${run.timeUnits}` : "";
  const units = run.timeUnits ? ` The time units are ${run.timeUnits}.` : "";
  const method = { euler: "Euler", rk2: "Runge-Kutta 2", rk4: "Runge-Kutta 4", rk45: "adaptive Runge-Kutta 4(5)" }[
    run.integration ?? "euler"
  ];
  return (
    `The simulation runs from ${run.start} to ${run.stop} with a time step (DT) of ${run.dt}${unit}` +
    ` and saves a result every ${run.saveEvery}${unit}, using ${method} integration.${units}`
  );
}

/** Build a natural-language Markdown description of the model from its graph
 * and equations. Deterministic: no sampling, AI, or network access. */
export function describeModel(model: Model): ModelDescription {
  const links = causalLinks(model);
  const pairs = uniqueLinks(links);

  const counts = (
    [
      [model.stocks.length, "stock"],
      [model.flows.length, "flow"],
      [model.converters.length, "converter"],
      [model.graphFunctions.length, "graph function"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}${n === 1 ? "" : "s"}`);

  const overview = [
    `**${display(model.name)}** is a stock-and-flow model with ${formatList(counts)}.`,
    model.documentation ? `\n${model.documentation}` : "",
  ]
    .filter(Boolean)
    .join("");

  const markdown = [
    "## Overview",
    overview,
    "",
    "## Stocks",
    describeStocks(model, links),
    "",
    "## Flows",
    describeFlows(model, links),
    "",
    "## Converters and graph functions",
    describeConverters(model, links),
    "",
    "## Feedback loops",
    describeLoops(model),
    "",
    "## Time settings",
    describeRun(model),
    "",
  ].join("\n");

  return {
    markdown,
    mentions: {
      elements: graphElements(model).map((e) => e.name),
      links: pairs,
    },
  };
}

/** Completeness check: which elements and causal links of the model the
 * description does NOT account for (by name match in `mentions`). */
export function coverage(
  model: Model,
  d: ModelDescription,
): { missingElements: string[]; missingLinks: Array<{ from: string; to: string }>; complete: boolean } {
  const mentionedElements = new Set(d.mentions.elements);
  const missingElements = graphElements(model)
    .map((e) => e.name)
    .filter((name) => !mentionedElements.has(name));

  const mentionedLinks = new Set(d.mentions.links.map(linkKey));
  const missingLinks = uniqueLinks(causalLinks(model)).filter((pair) => !mentionedLinks.has(linkKey(pair)));

  return {
    missingElements,
    missingLinks,
    complete: missingElements.length === 0 && missingLinks.length === 0,
  };
}
