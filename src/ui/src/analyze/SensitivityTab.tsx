/**
 * SourceSink — Sensitivity tab: Morris screening or Sobol variance
 * decomposition, reduced to a selectable output metric and rendered as
 * horizontal bars (μ* with a σ marker, or S1/ST with confidence whiskers).
 */

import { useMemo, useState } from "react";
import { CircleCheck, Loader2, Play, Square, TriangleAlert } from "lucide-react";

import type { MorrisResult, SobolResult } from "@sourcesink/analysis";
import type { Model } from "@sourcesink/model";

import { formatNumber } from "../results/csv.js";
import { seriesNames } from "../results/series.js";
import { BarChart, type BarGroup } from "./BarChart.js";
import { readMorris, readSobol } from "./explain.js";
import { InfoTip } from "./InfoTip.js";
import {
  describeMetric,
  makeOutputMetric,
  STAT_LABELS,
  morrisRequest,
  sobolRequest,
  validateParameterRows,
  type ParameterRow,
  type Statistic,
} from "./helpers.js";
import { ParameterRows } from "./ParameterRows.js";
import { useAnalyzeWorker, type AnalyzeWorkerEvents } from "./useAnalyzeWorker.js";

export interface SensitivityTabProps {
  model: Model;
  params: ParameterRow[];
  onParamsChange(rows: ParameterRow[]): void;
  /** Run lifecycle, so the shell can show background progress. */
  events?: AnalyzeWorkerEvents;
}

export function SensitivityTab({ model, params, onParamsChange, events }: SensitivityTabProps) {
  const worker = useAnalyzeWorker(events);
  const modelSeries = useMemo(() => seriesNames(model), [model]);
  const validation = useMemo(() => validateParameterRows(params, model), [params, model]);

  const [outputSeries, setOutputSeries] = useState(() => seriesNames(model)[0] ?? "");
  const [stat, setStat] = useState<Statistic>("final");
  const [atTime, setAtTime] = useState("0");
  const [method, setMethod] = useState<"morris" | "sobol">("morris");
  const [trajectories, setTrajectories] = useState("20");
  const [samples, setSamples] = useState("512");
  const [morrisResult, setMorrisResult] = useState<MorrisResult | null>(null);
  const [sobolResult, setSobolResult] = useState<SobolResult | null>(null);

  const atValid = stat !== "at" || Number.isFinite(Number(atTime));
  const metric = useMemo(
    () => (outputSeries ? makeOutputMetric(outputSeries, stat, atTime) : null),
    [outputSeries, stat, atTime],
  );
  const canRun = Boolean(metric) && validation.ok && atValid && !worker.running;

  const run = (): void => {
    if (!metric) return;
    setMorrisResult(null);
    setSobolResult(null);
    worker.run(
      (id) =>
        method === "morris"
          ? morrisRequest(id, model, validation.specs, metric, {
              trajectories: Math.max(1, Math.floor(Number(trajectories) || 20)),
              seed: 1,
            })
          : sobolRequest(id, model, validation.specs, metric, {
              samples: Math.max(2, Math.floor(Number(samples) || 512)),
              seed: 1,
            }),
      (response) => {
        if (response.kind === "morris") setMorrisResult(response.result);
        if (response.kind === "sobol") setSobolResult(response.result);
      },
    );
  };

  const morrisGroups: BarGroup[] = useMemo(() => {
    if (!morrisResult) return [];
    return morrisResult.parameters.map((p, i) => ({
      label: p.name,
      reading: readMorris(p, i + 1, morrisResult.parameters),
      title: `${p.name} — μ = ${formatNumber(p.mu)}, μ* = ${formatNumber(p.muStar)}, σ = ${formatNumber(p.sigma)}`,
      values: [{ key: "μ*", value: p.muStar, color: "var(--accent)", marker: p.sigma }],
    }));
  }, [morrisResult]);

  const sobolGroups: BarGroup[] = useMemo(() => {
    if (!sobolResult) return [];
    return sobolResult.parameters.map((p, i) => ({
      label: p.name,
      reading: readSobol(p, i + 1),
      title: `${p.name} — S1 = ${formatNumber(p.first)} [${formatNumber(p.firstCI[0])}, ${formatNumber(
        p.firstCI[1],
      )}], ST = ${formatNumber(p.total)} [${formatNumber(p.totalCI[0])}, ${formatNumber(p.totalCI[1])}]`,
      values: [
        {
          key: "S1",
          value: p.first,
          color: "var(--accent)",
          low: p.firstCI[0],
          high: p.firstCI[1],
        },
        {
          key: "ST",
          value: p.total,
          color: "var(--converter)",
          low: p.totalCI[0],
          high: p.totalCI[1],
        },
      ],
    }));
  }, [sobolResult]);

  const result = method === "morris" ? morrisResult : sobolResult;

  return (
    <div className="ana-tabpane">
      <section className="ana-section" aria-label="Output metric">
        <h3 className="ana-section-title">
          Output metric
          <InfoTip title="Output metric">
            <p>
              Sensitivity analysis needs one number from each run. Pick the series you care about and how
              to boil its time path down to a number.
            </p>
            <p>
              For example, the <b>Minimum</b> of a dissolved-oxygen series is the depth of the sag, and the{" "}
              <b>Final value</b> of a stock is where it ends up. The ranking can change completely with the
              metric, so choose the one that answers your question.
            </p>
          </InfoTip>
        </h3>
        <div className="ana-grid-3">
          <label className="ana-field">
            <span className="ana-label">Series</span>
            <select
              className="ana-select"
              value={outputSeries}
              disabled={worker.running}
              onChange={(event) => setOutputSeries(event.target.value)}
            >
              {modelSeries.length === 0 ? <option value="">No series</option> : null}
              {modelSeries.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="ana-field">
            <span className="ana-label">
              Statistic
              <InfoTip title="Statistic">
                <p>
                  <b>Final value</b>: the value at the stop time. <b>Maximum</b> / <b>Minimum</b>: the peak
                  or trough over the run. <b>Time-average</b>: the mean over the run.{" "}
                  <b>Integral</b>: the area under the curve, such as a total load or exposure.{" "}
                  <b>Value at time…</b>: the value at the time you enter.
                </p>
              </InfoTip>
            </span>
            <select
              className="ana-select"
              value={stat}
              disabled={worker.running}
              onChange={(event) => setStat(event.target.value as Statistic)}
            >
              {STAT_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ana-field">
            <span className="ana-label">At time</span>
            <input
              className="ana-input"
              inputMode="decimal"
              value={atTime}
              disabled={stat !== "at" || worker.running}
              onChange={(event) => setAtTime(event.target.value)}
            />
          </label>
        </div>
        {!atValid ? <div className="ana-row-error">Enter a numeric time for the “at” statistic.</div> : null}
      </section>

      <section className="ana-section" aria-label="Sensitivity parameters">
        <h3 className="ana-section-title">
          Parameters
          <InfoTip title="Parameters and ranges">
            <p>
              Each parameter is varied between its <b>Min</b> and <b>Max</b>. Use the range you actually
              believe is plausible, such as values reported in the literature or seen in the field. Results
              are only as meaningful as these ranges.
            </p>
            <p>
              Tick <b>Log</b> when a range spans more than about 10× (for example 0.01 to 1). Values are then
              spread evenly in orders of magnitude, so the low end is not under-sampled.
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
      </section>

      <section className="ana-section" aria-label="Sensitivity method">
        <h3 className="ana-section-title">
          Method
          <InfoTip title="Morris or Sobol?">
            <p>
              <b>Quick screen (Morris)</b> moves one parameter at a time along random paths through the
              ranges. It is cheap, so use it first, with many parameters, to find the few that matter.
            </p>
            <p>
              <b>Variance-based (Sobol)</b> samples all parameters together and splits the spread of the
              output into shares due to each parameter and their interactions. It costs more runs, so use it
              on the short list Morris gives you.
            </p>
          </InfoTip>
        </h3>
        <div className="ana-grid-3">
          <label className="ana-field">
            <span className="ana-label">Method</span>
            <select
              className="ana-select"
              value={method}
              disabled={worker.running}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              <option value="morris">Quick screen (Morris)</option>
              <option value="sobol">Variance-based (Sobol)</option>
            </select>
          </label>
          {method === "morris" ? (
            <label className="ana-field">
              <span className="ana-label">
                Trajectories
                <InfoTip title="Trajectories">
                  <p>
                    Each trajectory is one random path that changes every parameter once. More trajectories
                    give a steadier ranking: 10 to 50 is typical. If the order of the top bars changes
                    between runs, add more.
                  </p>
                </InfoTip>
              </span>
              <input
                className="ana-input"
                inputMode="numeric"
                value={trajectories}
                disabled={worker.running}
                onChange={(event) => setTrajectories(event.target.value)}
              />
            </label>
          ) : (
            <label className="ana-field">
              <span className="ana-label">
                Base samples
                <InfoTip title="Base samples">
                  <p>
                    The size N of the quasi-random sample. The cost is N × (parameters + 2) runs. 512 to 1024
                    is typical. The confidence whiskers shrink as N grows, so raise it when they overlap
                    between parameters.
                  </p>
                </InfoTip>
              </span>
              <input
                className="ana-input"
                inputMode="numeric"
                value={samples}
                disabled={worker.running}
                onChange={(event) => setSamples(event.target.value)}
              />
            </label>
          )}
          <div className="ana-field ana-field-hint">
            <span className="ana-label">Cost</span>
            <span className="ana-muted">
              {method === "morris"
                ? "trajectories × (parameters + 1) runs"
                : "samples × (parameters + 2) runs"}
            </span>
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
              Run
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
              {!metric
                ? "Choose a series to analyse."
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
        <section className="ana-section" aria-label="Sensitivity result">
          <div className="ana-section-head">
            <h3 className="ana-section-title">
              {method === "morris" ? "Morris elementary effects" : "Sobol indices"}
              {method === "morris" ? (
                <InfoTip title="Reading a Morris screen">
                  <p>
                    <b>μ*</b> (the bar) is the average size of the change in the output when this parameter
                    moves. Bigger means more influential. Effects are measured on each range scaled to 0–1,
                    so bars compare fairly across units.
                  </p>
                  <p>
                    <b>σ</b> (the thin tick) is how much that effect varies from place to place. When σ is
                    small next to μ*, the effect is close to linear. When σ is close to or above μ*, the
                    effect is non-linear or depends on other parameters.
                  </p>
                </InfoTip>
              ) : (
                <InfoTip title="Reading Sobol indices">
                  <p>
                    <b>S1</b> is the share of the output&rsquo;s variance this parameter causes on its own.{" "}
                    <b>ST</b> adds the share from its interactions with other parameters. Both run from 0 to
                    1.
                  </p>
                  <p>
                    A big gap between ST and S1 means interactions. ST near 0 means the parameter can be
                    fixed. The whiskers are bootstrap 95% confidence intervals: if two whiskers overlap, the
                    order of those two parameters is not settled.
                  </p>
                </InfoTip>
              )}
            </h3>
            <span className="ana-badge ana-badge-ok">
              <CircleCheck size={12} aria-hidden />
              {method === "morris" ? "μ* ranking" : "S1 / ST"}
            </span>
          </div>
          <p className="ana-muted ana-hover-hint">Hover a bar to see what it means.</p>
          <p className="ana-muted">
            {describeMetric(result.metric)} · {result.evaluations.toLocaleString()} evaluations
            {result.failed > 0 ? ` · ${result.failed} failed` : ""}
            {method === "sobol" && "variance" in result
              ? ` · output variance ${formatNumber(result.variance)}`
              : ""}
          </p>

          {method === "morris" ? (
            <BarChart
              groups={morrisGroups}
              ariaLabel="Morris mu-star sensitivity with sigma markers"
              legend={[
                { label: "μ* (mean absolute elementary effect)", color: "var(--accent)" },
                { label: "σ (interaction / non-linearity)", color: "var(--text-muted)", marker: true },
              ]}
            />
          ) : (
            <BarChart
              groups={sobolGroups}
              ariaLabel="Sobol first-order and total sensitivity indices with 95% confidence intervals"
              legend={[
                { label: "S1 (first order)", color: "var(--accent)" },
                { label: "ST (total)", color: "var(--converter)" },
              ]}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
