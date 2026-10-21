/**
 * SourceSink — Sweep tab: run the model across a range of one parameter (a
 * response curve plus the family of runs) or a grid of two (a heat map), and
 * say in words what stands out: thresholds, optima, where the response
 * levels off, which parameter dominates. A suggested narrower range can be
 * applied with one click to zoom in.
 */

import { useMemo, useState } from "react";
import { Loader2, Play, Plus, Square, TriangleAlert, X, ZoomIn } from "lucide-react";

import { curveFeatures, surfaceFeatures, type SweepAxis, type SweepResult } from "@sourcesink/analysis";
import type { Model } from "@sourcesink/model";

import { formatNumber } from "../results/csv.js";
import { downloadBlob, safeFileName } from "../results/exportChart.js";
import { seriesNames } from "../results/series.js";
import { useChartTheme } from "../results/useChartTheme.js";
import { AnalyzeChart, alphaColor } from "./AnalyzeChart.js";
import { readCurve, readSurface } from "./explain.js";
import {
  describeMetric,
  makeOutputMetric,
  numericEquation,
  parameterOptions,
  STAT_LABELS,
  suggestedBounds,
  type Statistic,
} from "./helpers.js";
import { InfoTip } from "./InfoTip.js";
import { SweepHeatmap } from "./SweepHeatmap.js";
import { useAnalyzeWorker, type AnalyzeWorkerEvents } from "./useAnalyzeWorker.js";

export interface SweepTabProps {
  model: Model;
  events?: AnalyzeWorkerEvents;
}

interface AxisDraft {
  name: string;
  min: string;
  max: string;
  steps: string;
  log: boolean;
}

const MAX_RUNS = 2500;

function draftFor(model: Model, name: string, steps: string): AxisDraft {
  const bounds = suggestedBounds(model, name);
  const min = Number(bounds.min);
  const max = Number(bounds.max);
  return { name, min: bounds.min, max: bounds.max, steps, log: min > 0 && max / min >= 50 };
}

function firstConstant(model: Model, skip?: string): string | undefined {
  const options = parameterOptions(model).filter((o) => o.name !== skip);
  return (options.find((o) => numericEquation(o.equation) !== undefined) ?? options[0])?.name;
}

function parseAxis(draft: AxisDraft): { axis?: SweepAxis; error?: string } {
  const min = Number(draft.min);
  const max = Number(draft.max);
  const steps = Math.floor(Number(draft.steps));
  if (!draft.name) return { error: "Choose a parameter to sweep." };
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { error: `Enter numeric bounds for ${draft.name}.` };
  if (max <= min) return { error: `${draft.name}: Max must be greater than Min.` };
  if (!(steps >= 2)) return { error: `${draft.name}: use at least 2 steps.` };
  if (draft.log && !(min > 0)) return { error: `${draft.name}: log scale needs Min > 0.` };
  return { axis: { name: draft.name, min, max, steps, scale: draft.log ? "log" : "linear" } };
}

/** Light-to-dark ramp of one hue for a family of runs. */
function rampColor(base: string, t: number): string {
  return alphaColor(base, 0.25 + 0.75 * t);
}

function AxisEditor({
  model,
  draft,
  disabled,
  label,
  onChange,
  onRemove,
}: {
  model: Model;
  draft: AxisDraft;
  disabled: boolean;
  label: string;
  onChange: (draft: AxisDraft) => void;
  onRemove?: () => void;
}) {
  const options = parameterOptions(model);
  return (
    <div className="ana-sweep-axis">
      <label className="ana-field ana-sweep-name">
        <span className="ana-label">{label}</span>
        <select
          className="ana-select"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => onChange(draftFor(model, event.target.value, draft.steps))}
        >
          {options.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
              {numericEquation(option.equation) === undefined ? " (computed)" : ` = ${option.equation}`}
            </option>
          ))}
        </select>
      </label>
      <label className="ana-field">
        <span className="ana-label">Min</span>
        <input
          className="ana-input"
          inputMode="decimal"
          value={draft.min}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, min: event.target.value })}
        />
      </label>
      <label className="ana-field">
        <span className="ana-label">Max</span>
        <input
          className="ana-input"
          inputMode="decimal"
          value={draft.max}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, max: event.target.value })}
        />
      </label>
      <label className="ana-field ana-sweep-steps">
        <span className="ana-label">Steps</span>
        <input
          className="ana-input"
          inputMode="numeric"
          value={draft.steps}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, steps: event.target.value })}
        />
      </label>
      <label className="ana-check ana-sweep-log" title="Space the steps evenly in orders of magnitude">
        <input
          type="checkbox"
          checked={draft.log}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, log: event.target.checked })}
        />
        log
      </label>
      {onRemove ? (
        <button type="button" className="ana-iconbtn" title="Remove the second parameter" disabled={disabled} onClick={onRemove}>
          <X size={14} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

/** Response curve and family of runs for a one-parameter sweep. Separate so
 * the chart theme is only read once there is something to draw. */
function SweepCurveCharts({
  result: oneD,
  metricLabel,
  familyName,
  timeUnits,
}: {
  result: SweepResult;
  metricLabel: string;
  familyName: string;
  timeUnits?: string;
}) {
  const result = oneD;
  const theme = useChartTheme();
  const accent = theme.palette[0] ?? theme.muted;
  // The chips may have changed since the run; fall back to what was kept.
  const shownName = result.traces[familyName] ? familyName : (Object.keys(result.traces)[0] ?? familyName);
  const allRuns = result.traces[shownName];
  // Thin very long sweeps to about 40 lines, always keeping both ends.
  const family = useMemo(() => {
    if (!allRuns) return undefined;
    const stride = Math.max(1, Math.ceil(allRuns.length / 40));
    return allRuns
      .map((values, index) => ({ values, index }))
      .filter(({ index }) => index % stride === 0 || index === allRuns.length - 1);
  }, [allRuns]);

  return (
            <>
              <AnalyzeChart
                time={oneD.axes[0].values}
                xLabel={oneD.axes[0].name}
                xLog={oneD.axes[0].scale === "log"}
                yLabel={metricLabel}
                title={`${metricLabel} against ${oneD.axes[0].name}`}
                exportName={`sweep-${oneD.axes[0].name}-${metricLabel}`}
                height={220}
                series={[{ name: metricLabel, color: accent, values: oneD.outputs, lineWidth: 2.25 }]}
              />
              {family ? (
                <AnalyzeChart
                  time={oneD.time}
                  timeUnits={timeUnits}
                  yLabel={shownName}
                  title={`${shownName} over time, one line per ${oneD.axes[0].name} value`}
                  note={`Light lines: low ${oneD.axes[0].name} (${formatNumber(oneD.axes[0].values[0])}); dark lines: high (${formatNumber(oneD.axes[0].values.at(-1)!)}).`}
                  exportName={`sweep-${oneD.axes[0].name}-${shownName}-runs`}
                  height={220}
                  series={family.map(({ values, index }, k) => ({
                    name: `${oneD.axes[0].name} = ${formatNumber(oneD.axes[0].values[index])}`,
                    color: rampColor(accent, family.length > 1 ? k / (family.length - 1) : 1),
                    values: values ?? [],
                    lineWidth: 1.4,
                  }))}
                  readout={(index) => {
                    let lo = { v: Number.POSITIVE_INFINITY, i: -1 };
                    let hi = { v: Number.NEGATIVE_INFINITY, i: -1 };
                    family.forEach(({ values, index: i }) => {
                      const v = values?.[index];
                      if (v == null || !Number.isFinite(v)) return;
                      if (v < lo.v) lo = { v, i };
                      if (v > hi.v) hi = { v, i };
                    });
                    if (lo.i < 0) return <span className="ana-readout-item">no data</span>;
                    const p = (i: number) => formatNumber(oneD.axes[0].values[i]);
                    return (
                      <>
                        <span className="ana-readout-item">
                          lowest {formatNumber(lo.v)} at {oneD.axes[0].name} = {p(lo.i)}
                        </span>
                        <span className="ana-readout-item">
                          highest {formatNumber(hi.v)} at {oneD.axes[0].name} = {p(hi.i)}
                        </span>
                      </>
                    );
                  }}
                />
              ) : null}
            </>
            );
}

export function SweepTab({ model, events }: SweepTabProps) {
  const worker = useAnalyzeWorker(events);
  const modelSeries = useMemo(() => seriesNames(model), [model]);

  const [axisA, setAxisA] = useState<AxisDraft>(() => {
    const name = firstConstant(model);
    return name ? draftFor(model, name, "21") : { name: "", min: "0", max: "1", steps: "21", log: false };
  });
  const [axisB, setAxisB] = useState<AxisDraft | null>(null);
  const [outputSeries, setOutputSeries] = useState(() => seriesNames(model)[0] ?? "");
  const [stat, setStat] = useState<Statistic>("final");
  const [atTime, setAtTime] = useState("0");
  const [traceSeries, setTraceSeries] = useState<string[]>([]);
  const [result, setResult] = useState<SweepResult | null>(null);

  const parsedA = parseAxis(axisA);
  const parsedB = axisB ? parseAxis(axisB) : undefined;
  const sameAxis = axisB !== null && axisB.name === axisA.name;
  const runs = (parsedA.axis?.steps ?? 0) * (parsedB?.axis?.steps ?? 1);
  const atValid = stat !== "at" || Number.isFinite(Number(atTime));
  const error =
    parsedA.error ??
    parsedB?.error ??
    (sameAxis ? "Pick two different parameters." : undefined) ??
    (runs > MAX_RUNS ? `${runs.toLocaleString()} runs is a lot; keep it under ${MAX_RUNS.toLocaleString()}.` : undefined) ??
    (!outputSeries ? "Choose an output series." : undefined) ??
    (!atValid ? "Enter a numeric time for the “at” statistic." : undefined);
  const canRun = !error && !worker.running;

  const run = (): void => {
    if (!parsedA.axis || error) return;
    const metric = makeOutputMetric(outputSeries, stat, atTime);
    const axes: [SweepAxis] | [SweepAxis, SweepAxis] = parsedB?.axis ? [parsedA.axis, parsedB.axis] : [parsedA.axis];
    const series = axes.length === 1 ? Array.from(new Set([outputSeries, ...traceSeries])) : [];
    setResult(null);
    worker.run(
      (id) => ({ id, kind: "sweep", model, axes, metric, series }),
      (response) => {
        if (response.kind === "sweep") setResult(response.result);
      },
    );
  };

  const metricLabel = result ? describeMetric(result.metric) : "";
  const familyName = traceSeries[0] ?? outputSeries;
  const oneD = result && result.axes.length === 1 ? result : null;
  const twoD = result && result.axes.length === 2 ? result : null;

  const curve = useMemo(() => (oneD ? curveFeatures(oneD.axes[0].values, oneD.outputs) : null), [oneD]);
  const curveReading = useMemo(
    () => (oneD && curve ? readCurve(curve, oneD.axes[0].name, metricLabel, oneD.axes[0].values) : null),
    [oneD, curve, metricLabel],
  );
  const surface = useMemo(
    () => (twoD ? surfaceFeatures(twoD.axes[0].values, twoD.axes[1].values, twoD.outputs) : null),
    [twoD],
  );
  const surfaceReading = useMemo(
    () =>
      twoD && surface ? readSurface(surface, [twoD.axes[0].name, twoD.axes[1].name], metricLabel) : null,
    [twoD, surface, metricLabel],
  );

  const zoomIn = (): void => {
    const zoom = curveReading?.zoom;
    if (!zoom) return;
    setAxisA((a) => ({ ...a, min: formatNumber(zoom.min), max: formatNumber(zoom.max) }));
  };

  const exportCsv = (): void => {
    if (!result) return;
    const [a, b] = result.axes;
    const header = b ? [a.name, b.name, metricLabel] : [a.name, metricLabel];
    const rows: string[] = [];
    if (b) {
      a.values.forEach((va, i) =>
        b.values.forEach((vb, j) => rows.push([va, vb, result.outputs[i * b.values.length + j]].join(","))),
      );
    } else {
      a.values.forEach((va, i) => rows.push([va, result.outputs[i]].join(",")));
    }
    const quote = (h: string) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h);
    const csv = `${[header.map(quote).join(","), ...rows].join("\n")}\n`;
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${safeFileName(`sweep-${header.slice(0, -1).join("-")}`)}.csv`);
  };


  return (
    <div className="ana-tabpane">
      <section className="ana-section" aria-label="Sweep parameters">
        <h3 className="ana-section-title">
          Parameters to sweep
          <InfoTip title="What a sweep does">
            <p>
              The model runs once at each of the <b>Steps</b> evenly spaced values between <b>Min</b> and <b>Max</b>,
              and the chosen output is plotted against the parameter. This is the quickest way to find thresholds
              (washout, collapse), optima, and the point where more of something stops helping.
            </p>
            <p>
              Tick <b>log</b> for ranges over more than about 10×. Start wide (say 0.1× to 10× the current value), then
              use <b>Zoom in</b> on whatever looks interesting.
            </p>
            <p>
              Add a <b>second parameter</b> to sweep a grid and see the response as a heat map, which shows how two
              settings trade off, for example SRT against HRT, or wetland area against loading.
            </p>
          </InfoTip>
        </h3>
        <AxisEditor model={model} draft={axisA} disabled={worker.running} label="Parameter" onChange={setAxisA} />
        {axisB ? (
          <AxisEditor
            model={model}
            draft={axisB}
            disabled={worker.running}
            label="Second parameter"
            onChange={setAxisB}
            onRemove={() => setAxisB(null)}
          />
        ) : (
          <button
            type="button"
            className="ana-btn ana-btn-add"
            disabled={worker.running}
            onClick={() => {
              const name = firstConstant(model, axisA.name);
              if (name) setAxisB(draftFor(model, name, "11"));
            }}
          >
            <Plus size={13} aria-hidden />
            Add a second parameter (heat map)
          </button>
        )}
      </section>

      <section className="ana-section" aria-label="Sweep output">
        <h3 className="ana-section-title">Output</h3>
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
            <span className="ana-label">Statistic</span>
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
        {!axisB ? (
          <div className="ana-field">
            <span className="ana-label">
              Also show runs of
              <InfoTip title="Family of runs">
                <p>
                  Besides the response curve, the tab draws the full time course of one series for every step,
                  shaded from light (low parameter) to dark (high). Pick a series here to see it; otherwise the
                  output series is shown.
                </p>
              </InfoTip>
            </span>
            <div className="ana-chips" role="group" aria-label="Series to show as a family of runs">
              {modelSeries.map((name) => {
                const active = traceSeries.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={active ? "ana-chip ana-chip-on" : "ana-chip"}
                    aria-pressed={active}
                    disabled={worker.running}
                    onClick={() => setTraceSeries(active ? [] : [name])}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="ana-runline">
          {worker.running ? (
            <button type="button" className="ana-btn" onClick={worker.cancel}>
              <Square size={13} aria-hidden />
              Cancel
            </button>
          ) : (
            <button type="button" className="ana-btn ana-btn-primary" disabled={!canRun} onClick={run}>
              <Play size={13} aria-hidden />
              Run sweep
            </button>
          )}
          {worker.running ? (
            <span className="ana-progress" role="status">
              <Loader2 size={13} className="ana-spin" aria-hidden />
              {worker.stage ?? "Running…"}
            </span>
          ) : error ? (
            <span className="ana-muted">{error}</span>
          ) : (
            <span className="ana-muted">{runs.toLocaleString()} runs</span>
          )}
        </div>

        {worker.error ? (
          <div className="ana-alert ana-alert-error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            <span>{worker.error}</span>
          </div>
        ) : null}
      </section>

      {result ? (
        <section className="ana-section" aria-label="Sweep result">
          <div className="ana-section-head">
            <h3 className="ana-section-title">What stands out</h3>
            <button type="button" className="ana-export" onClick={exportCsv} title="Download the sweep table">
              CSV
            </button>
          </div>
          <ul className="ana-findings">
            {(curveReading?.lines ?? surfaceReading ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {result.failed > 0 ? (
              <li className="ana-findings-warn">
                {result.failed} of {result.outputs.length} runs failed
                {result.firstError ? ` (${result.firstError})` : ""}; they are left as gaps.
              </li>
            ) : null}
          </ul>
          {curveReading?.zoom ? (
            <button type="button" className="ana-btn" onClick={zoomIn} disabled={worker.running}>
              <ZoomIn size={13} aria-hidden />
              Zoom in {curveReading.zoom.reason}: {oneD?.axes[0].name} {formatNumber(curveReading.zoom.min)} to{" "}
              {formatNumber(curveReading.zoom.max)}
            </button>
          ) : null}

          {oneD ? (
            <SweepCurveCharts
              result={oneD}
              metricLabel={metricLabel}
              familyName={familyName}
              timeUnits={model.run.timeUnits}
            />
          ) : null}

          {twoD ? <SweepHeatmap result={twoD} metricLabel={metricLabel} /> : null}
        </section>
      ) : null}
    </div>
  );
}
