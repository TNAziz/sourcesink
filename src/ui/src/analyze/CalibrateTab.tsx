/**
 * SourceSink — Calibrate tab: load observations, choose parameters and fit
 * them in a Web Worker. The panel never blocks the editor: every run goes
 * through `calibrate` inside `worker.ts`, with a Cancel button that terminates
 * the worker.
 */

import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  CircleCheck,
  Loader2,
  Play,
  Square,
  TriangleAlert,
  Upload,
  Wand2,
} from "lucide-react";

import { parseCsv } from "@sourcesink/analysis";
import { canonicalName } from "@sourcesink/engine";
import type { Alignment, Dataset, FitResult, ObjectiveKind } from "@sourcesink/analysis";
import type { Model } from "@sourcesink/model";

import { formatNumber } from "../results/csv.js";
import { seriesNames } from "../results/series.js";
import { useChartTheme } from "../results/useChartTheme.js";
import { useEditor } from "../state/store.js";
import { AnalyzeChart } from "./AnalyzeChart.js";
import {
  OBJECTIVE_LABELS,
  buildMappedDataset,
  calibrateRequest,
  formatEstimate,
  matchColumns,
  validateParameterRows,
  type ColumnMapping,
  type ParameterRow,
  relativeError,
} from "./helpers.js";
import { ParameterRows } from "./ParameterRows.js";
import { useAnalyzeWorker, type AnalyzeWorkerEvents } from "./useAnalyzeWorker.js";

export interface CalibrateTabProps {
  model: Model;
  params: ParameterRow[];
  onParamsChange(rows: ParameterRow[]): void;
  /** Run lifecycle, so the shell can show background progress. */
  events?: AnalyzeWorkerEvents;
}

function show(value: number): string {
  return Number.isFinite(value) ? formatNumber(value) : "—";
}

function FitChartBlock({ alignment, timeUnits }: { alignment: Alignment; timeUnits?: string }) {
  const theme = useChartTheme();
  return (
    <AnalyzeChart
      time={alignment.time}
      timeUnits={timeUnits}
      title={`${alignment.series} — observations and fitted model`}
      exportName={`${alignment.series}-fit`}
      yLabel={alignment.series}
      note="Dots are observed values; the line is the simulation at the best parameters."
      series={[
        {
          name: `${alignment.series} observed`,
          color: theme.palette[1] ?? theme.muted,
          values: alignment.observed,
          points: true,
        },
        {
          name: `${alignment.series} fitted`,
          color: theme.palette[0] ?? theme.muted,
          values: alignment.simulated,
          lineWidth: 2,
        },
      ]}
    />
  );
}

export function CalibrateTab({ model, params, onParamsChange, events }: CalibrateTabProps) {
  const updateElement = useEditor((s) => s.updateElement);
  const worker = useAnalyzeWorker(events);
  const fileRef = useRef<HTMLInputElement>(null);

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [method, setMethod] = useState<"nelder-mead" | "differential-evolution">("nelder-mead");
  const [objective, setObjective] = useState<ObjectiveKind>("sse");
  const [starts, setStarts] = useState("1");
  const [result, setResult] = useState<FitResult | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const validation = useMemo(() => validateParameterRows(params, model), [params, model]);
  const mapped = useMemo(
    () => (dataset ? buildMappedDataset(dataset, mapping) : { dataset: null, error: null }),
    [dataset, mapping],
  );
  const modelSeries = useMemo(() => seriesNames(model), [model]);
  const canRun = Boolean(mapped.dataset) && validation.ok && !worker.running;

  const loadFile = async (file: File): Promise<void> => {
    setParseError(null);
    setResult(null);
    setApplied(null);
    setFileName(file.name);
    try {
      const parsed = parseCsv(await file.text());
      setDataset(parsed);
      setMapping(matchColumns(parsed, model));
    } catch (error) {
      setDataset(null);
      setMapping([]);
      setParseError(error instanceof Error ? error.message : String(error));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const fit = (): void => {
    if (!mapped.dataset) return;
    setApplied(null);
    setResult(null);
    worker.run(
      (id) =>
        calibrateRequest(id, model, {
          data: mapped.dataset!,
          params: validation.specs,
          options: {
            method,
            objective,
            starts: Math.max(1, Math.floor(Number(starts) || 1)),
            seed: 1,
          },
        }),
      (response) => {
        if (response.kind === "calibrate") setResult(response.result);
      },
    );
  };

  const applyFitted = (): void => {
    if (!result) return;
    const targets = [...model.stocks, ...model.flows, ...model.converters];
    let count = 0;
    for (const [name, value] of Object.entries(result.parameters)) {
      const key = canonicalName(name);
      const element = targets.find((e) => canonicalName(e.name) === key);
      if (element) {
        updateElement(element.id, { equation: String(value) });
        count += 1;
      }
    }
    setApplied(`Applied ${count} fitted value${count === 1 ? "" : "s"} to the model.`);
  };

  return (
    <div
      className="ana-tabpane"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <section
        className={`ana-section ana-drop${dragging ? " ana-drop-on" : ""}`}
        aria-label="Observations"
      >
        <div className="ana-section-head">
          <h3 className="ana-section-title">Observations</h3>
          <button
            type="button"
            className="ana-btn"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={13} aria-hidden />
            Load CSV…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = "";
            }}
          />
        </div>
        <p className="ana-muted ana-drop-hint">
          Drop a CSV, TSV or text file here, or use Load CSV. The first numeric/date column is
          time; other columns are matched to model elements by name.
        </p>

        {parseError ? (
          <div className="ana-alert ana-alert-error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            <span>{parseError}</span>
          </div>
        ) : null}

        {dataset ? (
          <>
            <div className="ana-fileline">
              <span className="ana-file-name">{fileName}</span>
              <span className="ana-muted">
                {dataset.time.length} rows · t = {show(dataset.time[0])}–{show(dataset.time[dataset.time.length - 1])}
              </span>
            </div>
            <div className="ana-mapping" role="group" aria-label="Column mapping">
              {mapping.map((entry, index) => (
                <div className="ana-map-row" key={entry.column}>
                  <span className="ana-map-column" title={entry.column}>
                    {entry.column}
                  </span>
                  <span className="ana-map-arrow" aria-hidden>
                    →
                  </span>
                  <select
                    className="ana-select"
                    aria-label={`Model element for ${entry.column}`}
                    value={entry.target ?? ""}
                    onChange={(event) =>
                      setMapping(
                        mapping.map((m, i) =>
                          i === index ? { ...m, target: event.target.value || null } : m,
                        ),
                      )
                    }
                  >
                    <option value="">Ignore column</option>
                    {modelSeries.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {mapped.error ? <div className="ana-row-error">{mapped.error}</div> : null}
          </>
        ) : null}
      </section>

      <section className="ana-section" aria-label="Parameters">
        <h3 className="ana-section-title">Parameters</h3>
        <ParameterRows
          model={model}
          rows={params}
          errors={validation.perRow}
          disabled={worker.running}
          onChange={onParamsChange}
        />
      </section>

      <section className="ana-section" aria-label="Calibration options">
        <h3 className="ana-section-title">Options</h3>
        <div className="ana-grid-3">
          <label className="ana-field">
            <span className="ana-label">Method</span>
            <select
              className="ana-select"
              value={method}
              disabled={worker.running}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              <option value="nelder-mead">Nelder–Mead</option>
              <option value="differential-evolution">Differential evolution</option>
            </select>
          </label>
          <label className="ana-field">
            <span className="ana-label">Objective</span>
            <select
              className="ana-select"
              value={objective}
              disabled={worker.running}
              onChange={(event) => setObjective(event.target.value as ObjectiveKind)}
            >
              {OBJECTIVE_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ana-field">
            <span className="ana-label">Restarts</span>
            <input
              className="ana-input"
              inputMode="numeric"
              value={starts}
              disabled={worker.running || method === "differential-evolution"}
              onChange={(event) => setStarts(event.target.value)}
            />
          </label>
        </div>

        <div className="ana-runline">
          {worker.running ? (
            <button type="button" className="ana-btn" onClick={worker.cancel}>
              <Square size={13} aria-hidden />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="ana-btn ana-btn-primary"
              disabled={!canRun}
              onClick={fit}
            >
              <Play size={13} aria-hidden />
              Fit
            </button>
          )}
          {worker.running ? (
            <span className="ana-progress" role="status">
              <Loader2 size={13} className="ana-spin" aria-hidden />
              {worker.stage ?? "Fitting…"}
            </span>
          ) : null}
          {!worker.running && !canRun ? (
            <span className="ana-muted">
              {!mapped.dataset
                ? "Load observations to fit."
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
        <section className="ana-section" aria-label="Fit result">
          <div className="ana-section-head">
            <h3 className="ana-section-title">Fit result</h3>
            <span className={result.converged ? "ana-badge ana-badge-ok" : "ana-badge"}>
              {result.converged ? <CircleCheck size={12} aria-hidden /> : null}
              {result.converged ? "Converged" : "Stopped at limit"}
            </span>
          </div>
          <p className="ana-muted">
            {result.method === "differential-evolution" ? "Differential evolution" : "Nelder–Mead"} ·{" "}
            {result.evaluations.toLocaleString()} evaluations · objective {show(result.objective)}
          </p>

          <table className="ana-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Fitted value</th>
                <th>Relative error</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.parameters).map(([name, value]) => {
                const se = result.identifiability.standardErrors[name];
                return (
                  <tr key={name}>
                    <td className="ana-cell-name">{name}</td>
                    <td>{formatEstimate(value, se)}</td>
                    <td className="ana-cell-muted">{relativeError(value, se)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.identifiability.warnings.length > 0 ? (
            <ul className="ana-warnings">
              {result.identifiability.warnings.map((warning) => (
                <li key={warning}>
                  <TriangleAlert size={13} aria-hidden />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {Object.keys(result.metrics).length > 0 ? (
            <table className="ana-table">
              <thead>
                <tr>
                  <th>Series</th>
                  <th>n</th>
                  <th>RMSE</th>
                  <th>NSE</th>
                  <th>R²</th>
                  <th>Bias</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.metrics).map(([name, metrics]) => (
                  <tr key={name}>
                    <td className="ana-cell-name">{name}</td>
                    <td>{metrics.n}</td>
                    <td>{show(metrics.rmse)}</td>
                    <td>{show(metrics.nse)}</td>
                    <td>{show(metrics.r2)}</td>
                    <td>{show(metrics.bias)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ana-muted">No observations could be paired with the simulation.</p>
          )}

          {result.alignments.map((alignment) => (
            <FitChartBlock
              key={alignment.series}
              alignment={alignment}
              timeUnits={model.run.timeUnits}
            />
          ))}

          <div className="ana-runline">
            <button type="button" className="ana-btn ana-btn-primary" onClick={applyFitted}>
              <Wand2 size={13} aria-hidden />
              Apply fitted values
            </button>
            {applied ? <span className="ana-ok">{applied}</span> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
