/**
 * SourceSink — evidence cards under an assistant message.
 *
 * When the assistant runs simulations to answer a grounded question, each run
 * is shown separately: its label, the facts it produced, and a compact chart
 * of the reported series. The user can check the numbers the reply cites
 * without leaving the conversation.
 */

import type { RunEvidence } from "@sourcesink/assistant";

import { AnalyzeChart, type AnalyzeSeriesSpec } from "../analyze/AnalyzeChart.js";

/** Okabe-Ito hues, matching the analysis charts' colourblind-safe set. */
const COLORS = ["#0072b2", "#d55e00", "#009e73", "#e69f00", "#cc79a7", "#56b4e9"];

function chartSeries(run: RunEvidence): AnalyzeSeriesSpec[] {
  return Object.entries(run.series).map(([name, values], index) => ({
    name,
    color: COLORS[index % COLORS.length],
    values,
  }));
}

/** Charts need a DOM and a measured container; static/server rendering (the
 * render smoke test) still shows labels, facts and errors. */
const canChart = typeof window !== "undefined";

function EvidenceCard({ run }: { run: RunEvidence }) {
  const series = chartSeries(run);
  return (
    <section className="ast-evidence-card" aria-label={`Simulation: ${run.request.label}`}>
      <h4 className="ast-evidence-title">{run.request.label}</h4>
      {run.ok ? (
        <ul className="ast-evidence-facts">
          {run.facts.map((fact, index) => (
            <li key={`${index}:${fact}`}>{fact}</li>
          ))}
        </ul>
      ) : (
        <p className="ast-error" role="alert">
          {run.error ?? "The run did not complete."}
        </p>
      )}
      {run.ok && canChart && series.length > 0 && run.time.length > 0 ? (
        <AnalyzeChart
          time={run.time}
          series={series}
          timeUnits={run.timeUnits}
          height={120}
        />
      ) : null}
    </section>
  );
}

export function EvidenceBlock({ evidence }: { evidence: RunEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="ast-evidence">
      {evidence.map((run, index) => (
        <EvidenceCard key={`${run.request.label}:${index}`} run={run} />
      ))}
    </div>
  );
}
