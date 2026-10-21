/**
 * SourceSink — Uncertainty tab: Latin-hypercube ensemble runs summarized into
 * median lines with 25–75% and 5–95% bands. Sampling, simulation and
 * summarization all happen in the worker.
 */

import { useMemo, useState } from "react";
import { Loader2, Play, Square, TriangleAlert } from "lucide-react";

import type { Model } from "@sourcesink/model";

import { defaultPlotted, seriesNames } from "../results/series.js";
import { useChartTheme } from "../results/useChartTheme.js";
import { AnalyzeChart, alphaColor } from "./AnalyzeChart.js";
import { readBands } from "./explain.js";
import { InfoTip } from "./InfoTip.js";
import { buildBandSeries, uncertaintyRequest, validateParameterRows, type ParameterRow } from "./helpers.js";
import { ParameterRows } from "./ParameterRows.js";
import { useAnalyzeWorker, type AnalyzeWorkerEvents } from "./useAnalyzeWorker.js";
import type { UncertaintyResult } from "./workerCore.js";

export interface UncertaintyTabProps {
  model: Model;
  params: ParameterRow[];
  onParamsChange(rows: ParameterRow[]): void;
  /** Run lifecycle, so the shell can show background progress. */
  events?: AnalyzeWorkerEvents;
}

function defaultSeries(model: Model): string[] {
  const stocks = defaultPlotted(model);
  return stocks.length > 0 ? stocks : seriesNames(model).slice(0, 1);
}

function BandChartBlock({
  name,
  result,
  timeUnits,
}: {
  name: string;
  result: UncertaintyResult;
  timeUnits?: string;
}) {
  const theme = useChartTheme();
  const stats = result.stats[name];
  const band = buildBandSeries(result.time, stats);
  const color = theme.palette[0] ?? theme.muted;

  return (
    <AnalyzeChart
      time={band.time}
      timeUnits={timeUnits}
      title={`${name} — median and uncertainty bands`}
      note="Median line; darker band 25–75%, lighter band 5–95%. Hover the chart to read the spread."
      readout={(i) =>
        readBands({
          p5: band.p5[i] ?? null,
          p25: band.p25[i] ?? null,
          median: band.median[i] ?? null,
          p75: band.p75[i] ?? null,
          p95: band.p95[i] ?? null,
        }).map((line) => (
          <span key={line} className="ana-readout-item">
            {line}
          </span>
        ))
      }
      series={[
        { name: "5%", color: "transparent", values: band.p5, lineWidth: 0 },
        {
          name: "95%",
          color: "transparent",
          values: band.p95,
          lineWidth: 0,
          bandTo: 1,
          bandFill: alphaColor(color, 0.11),
        },
        { name: "25%", color: "transparent", values: band.p25, lineWidth: 0 },
        {
          name: "75%",
          color: "transparent",
          values: band.p75,
          lineWidth: 0,
          bandTo: 3,
          bandFill: alphaColor(color, 0.2),
        },
        { name: "Median", color, values: band.median, lineWidth: 2 },
      ]}
    />
  );
}

export function UncertaintyTab({ model, params, onParamsChange, events }: UncertaintyTabProps) {
  const worker = useAnalyzeWorker(events);
  const modelSeries = useMemo(() => seriesNames(model), [model]);
  const validation = useMemo(() => validateParameterRows(params, model), [params, model]);

  const [runs, setRuns] = useState("200");
  const [selected, setSelected] = useState<string[]>(() => defaultSeries(model));
  const [result, setResult] = useState<UncertaintyResult | null>(null);

  const runCount = Math.floor(Number(runs) || 0);
  const canRun = validation.ok && selected.length > 0 && runCount >= 1 && !worker.running;

  const toggle = (name: string): void => {
    setSelected((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
    );
  };

  const run = (): void => {
    setResult(null);
    worker.run(
      (id) => uncertaintyRequest(id, model, validation.specs, runCount, selected, 1),
      (response) => {
        if (response.kind === "uncertainty") setResult(response.result);
      },
    );
  };

  return (
    <div className="ana-tabpane">
      <section className="ana-section" aria-label="Uncertainty parameters">
        <h3 className="ana-section-title">
          Parameters
          <InfoTip title="What gets sampled">
            <p>
              Every run draws a value for each parameter from its <b>Min</b> to <b>Max</b> range at the same
              time. The draws use a Latin hypercube: each range is cut into equal slices and every slice is
              used once, so even a few hundred runs cover the ranges evenly.
            </p>
            <p>
              Set ranges that reflect what you really don&rsquo;t know about each value. The bands show how much
              that uncertainty spreads the results.
            </p>
          </InfoTip>
        </h3>
        <ParameterRows
          model={model}
          rows={params}
          errors={validation.perRow}
          disabled={worker.running}
          onChange={onParamsChange}
        />
        <p className="ana-muted">
          Parameters are sampled uniformly inside their ranges (log-uniformly with “log”).
        </p>
      </section>

      <section className="ana-section" aria-label="Ensemble settings">
        <h3 className="ana-section-title">Ensemble</h3>
        <div className="ana-grid-3">
          <label className="ana-field">
            <span className="ana-label">
              Runs
              <InfoTip title="How many runs?">
                <p>
                  The 5% and 95% edges need enough runs in the tails to be stable: 200 to 500 is a good
                  start. If the light band looks jagged, double the runs.
                </p>
              </InfoTip>
            </span>
            <input
              className="ana-input"
              inputMode="numeric"
              value={runs}
              disabled={worker.running}
              onChange={(event) => setRuns(event.target.value)}
            />
          </label>
        </div>

        <div className="ana-field">
          <span className="ana-label">Series to show</span>
          <div className="ana-chips" role="group" aria-label="Series to show">
            {modelSeries.map((name) => {
              const active = selected.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={active ? "ana-chip ana-chip-on" : "ana-chip"}
                  aria-pressed={active}
                  disabled={worker.running}
                  onClick={() => toggle(name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ana-runline">
          {worker.running ? (
            <button type="button" className="ana-btn" onClick={worker.cancel}>
              <Square size={13} aria-hidden />
              Cancel
            </button>
          ) : (
            <button type="button" className="ana-btn ana-btn-primary" disabled={!canRun} onClick={run}>
              <Play size={13} aria-hidden />
              Run ensemble
            </button>
          )}
          {worker.running ? (
            <span className="ana-progress" role="status">
              <Loader2 size={13} className="ana-spin" aria-hidden />
              {worker.stage ?? "Running…"}
            </span>
          ) : null}
          {!worker.running && !canRun ? (
            <span className="ana-muted">
              {selected.length === 0
                ? "Choose at least one series."
                : runCount < 1
                  ? "Runs must be at least 1."
                  : validation.errors[0] ?? "Fix the parameters to continue."}
            </span>
          ) : null}
        </div>

        {worker.error ? (
          <div className="ana-alert ana-alert-error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            <span>{worker.error}</span>
          </div>
        ) : null}
      </section>

      {result ? (
        <section className="ana-section" aria-label="Uncertainty result">
          <h3 className="ana-section-title">
            Ensemble summary
            <InfoTip title="Reading the bands">
              <p>
                The <b>line</b> is the median run at each time: half the runs are above it.
              </p>
              <p>
                The <b>dark band</b> holds the middle 50% of runs (25th to 75th percentile), and the{" "}
                <b>light band</b> the middle 90% (5th to 95th).
              </p>
              <p>
                A wide band at a time means the parameter ranges you set matter a lot there. Use Sensitivity
                to find out which parameter is responsible. The bands are built time by time, so the median
                line is not any single run.
              </p>
            </InfoTip>
          </h3>
          <p className="ana-muted">
            {result.runs.toLocaleString()} runs
            {result.failed > 0 ? ` · ${result.failed} failed` : " · all runs succeeded"}
          </p>
          {selected.map((name) =>
            result.stats[name] ? (
              <BandChartBlock
                key={name}
                name={name}
                result={result}
                timeUnits={model.run.timeUnits}
              />
            ) : null,
          )}
        </section>
      ) : null}
    </div>
  );
}
