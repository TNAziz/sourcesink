/**
 * Results drawer: graph and table views of the last run, a series picker,
 * run metadata and export (PNG, SVG, CSV). The graph has three layouts:
 * every series on one plot, one panel per series with a shared cursor, and a
 * phase plot of one series against another; the y axis can be logarithmic.
 * Mounted into the shell's bottom drawer and sized entirely by the container.
 */
import { useMemo, useState } from "react";
import { ChartLine, Play, Table2, TriangleAlert } from "lucide-react";
import { useEditor } from "../state/store";
import { csvFileName, toCsv } from "./csv";
import { chartSvg, downloadBlob, exportChart, safeFileName, svgToPng, type ExportChartSpec } from "./exportChart";
import { ExportMenu, type ExportFormat } from "./ExportMenu";
import { PhasePlot, phaseSpec } from "./PhasePlot";
import { seriesColorMap } from "./palette";
import { effectivePlotted, runCaption, seriesNames, togglePlotted } from "./series";
import { ResultsTable } from "./ResultsTable";
import { UPlotChart, type ChartSeries } from "./UPlotChart";
import { useChartTheme } from "./useChartTheme";
import "./results.css";

type Tab = "graph" | "table";
type Layout = "combined" | "panels" | "phase";

const LAYOUTS: Array<{ id: Layout; label: string; hint: string }> = [
  { id: "combined", label: "One plot", hint: "Every plotted series on one set of axes" },
  { id: "panels", label: "Panels", hint: "One panel per series, each with its own y axis; the cursor is shared" },
  { id: "phase", label: "Phase plot", hint: "One series against another; time runs along the curve" },
];

/** Stack several chart SVGs into one tall document. */
function stackSvgs(parts: string[], width: number, height: number): string {
  const body = parts.map((svg, i) => svg.replace("<svg ", `<svg x="0" y="${i * height}" `)).join("\n");
  const total = height * parts.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">\n${body}\n</svg>`;
}

export function ResultsPanel() {
  const result = useEditor((s) => s.result);
  const runError = useEditor((s) => s.runError);
  const plotted = useEditor((s) => s.plotted);
  const model = useEditor((s) => s.model);
  const run = useEditor((s) => s.run);
  const setPlotted = useEditor((s) => s.setPlotted);
  const theme = useChartTheme();
  const [tab, setTab] = useState<Tab>("graph");
  const [layout, setLayout] = useState<Layout>("combined");
  const [yLog, setYLog] = useState(false);
  const [phaseX, setPhaseX] = useState("");
  const [phaseY, setPhaseY] = useState("");

  const available = useMemo(() => (result ? Object.keys(result.series) : []), [result]);
  const chips = useMemo(() => seriesNames(model, available), [model, available]);
  const colors = useMemo(() => seriesColorMap(chips, theme.palette), [chips, theme.palette]);
  const effective = useMemo(
    () => effectivePlotted(plotted, model, available),
    [plotted, model, available],
  );

  const exportCsv = (): void => {
    if (!result) return;
    const columns = effective.length > 0 ? effective : seriesNames(model);
    downloadBlob(new Blob([toCsv(result, columns)], { type: "text/csv;charset=utf-8" }), csvFileName(model.name));
  };

  // Phase plot axes: the chosen pair, else the first two plotted series.
  const phasePair = useMemo(() => {
    const pool = effective.length >= 2 ? effective : available;
    const xName = available.includes(phaseX) ? phaseX : (pool[0] ?? "");
    const yName = available.includes(phaseY) && phaseY !== xName ? phaseY : (pool.find((n) => n !== xName) ?? "");
    return { xName, yName };
  }, [effective, available, phaseX, phaseY]);

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      effective.map((name) => ({
        name,
        color: colors.get(name) ?? theme.muted,
        values: result?.series[name] ?? [],
      })),
    [effective, colors, result, theme.muted],
  );

  const title = model.name || "SourceSink model";
  const timeLabel = model.run.timeUnits || "time";

  const onExport = async (format: ExportFormat): Promise<void> => {
    if (!result) return;
    if (format === "csv") return exportCsv();
    const base = `${title}-${layout === "phase" ? `${phasePair.yName}-vs-${phasePair.xName}` : effective.join("-")}`;
    if (layout === "phase") {
      const spec = {
        ...phaseSpec(
          {
            time: result.time,
            x: { name: phasePair.xName, values: result.series[phasePair.xName] ?? [] },
            y: { name: phasePair.yName, values: result.series[phasePair.yName] ?? [] },
            color: colors.get(phasePair.yName) ?? theme.muted,
            timeUnits: model.run.timeUnits,
          },
          { width: 1000, height: 800 },
        ),
        title: `${phasePair.yName} against ${phasePair.xName}`,
        subtitle: title,
      };
      return exportChart(spec, format, base);
    }
    if (layout === "panels" && chartSeries.length > 1) {
      const width = 1200;
      const height = 340;
      const parts = chartSeries.map((s, i) =>
        chartSvg({
          title: i === 0 ? title : undefined,
          x: result.time,
          xLabel: i === chartSeries.length - 1 ? timeLabel : undefined,
          yLabel: s.name,
          yLog,
          width,
          height,
          series: [{ name: s.name, color: s.color, values: s.values, legend: false }],
        }),
      );
      const svg = stackSvgs(parts, width, height);
      const name = safeFileName(base);
      if (format === "svg") downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
      else downloadBlob(await svgToPng(svg, width, height * parts.length, 2), `${name}.png`);
      return;
    }
    const spec: ExportChartSpec = {
      title,
      x: result.time,
      xLabel: timeLabel,
      yLog,
      series: chartSeries.map((s) => ({ name: s.name, color: s.color, values: s.values })),
    };
    return exportChart(spec, format, base);
  };

  return (
    <section className="res-root">
      <header className="res-header">
        <div className="res-tabs" role="tablist" aria-label="Results view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "graph"}
            className={tab === "graph" ? "res-tab res-tab-on" : "res-tab"}
            onClick={() => setTab("graph")}
          >
            <ChartLine size={13} aria-hidden />
            Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "table"}
            className={tab === "table" ? "res-tab res-tab-on" : "res-tab"}
            onClick={() => setTab("table")}
          >
            <Table2 size={13} aria-hidden />
            Table
          </button>
        </div>
        {tab === "graph" ? (
          <div className="res-layouts" role="group" aria-label="Graph layout">
            {LAYOUTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={layout === entry.id ? "res-layout res-layout-on" : "res-layout"}
                aria-pressed={layout === entry.id}
                title={entry.hint}
                onClick={() => setLayout(entry.id)}
              >
                {entry.label}
              </button>
            ))}
            {layout !== "phase" ? (
              <label className="res-log" title="Logarithmic y axis (values at or below zero are hidden)">
                <input type="checkbox" checked={yLog} onChange={(event) => setYLog(event.target.checked)} />
                Log y
              </label>
            ) : null}
          </div>
        ) : null}
        <span className="res-caption">{runCaption(model.run)}</span>
        <ExportMenu
          onExport={onExport}
          disabled={result === null}
          formats={tab === "table" ? ["csv"] : ["png", "svg", "csv"]}
        />
      </header>

      <div className="res-chips" role="group" aria-label="Series to plot">
        {chips.map((name) => {
          const active = effective.includes(name);
          return (
            <button
              key={name}
              type="button"
              className={active ? "res-chip res-chip-on" : "res-chip"}
              aria-pressed={active}
              title={active ? `Hide ${name}` : `Plot ${name}`}
              onClick={() => setPlotted(togglePlotted(plotted, name, model))}
            >
              <span className="res-chip-dot" style={{ background: colors.get(name) }} />
              {name}
            </button>
          );
        })}
      </div>

      {runError !== null && (
        <div className="res-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          <span>{runError}</span>
        </div>
      )}

      <div className="res-body">
        {result === null ? (
          <div className="res-empty">
            <ChartLine size={26} strokeWidth={1.75} aria-hidden />
            <h3>No results yet</h3>
            <p>Run the model to plot stocks, flows and converters over time.</p>
            <button type="button" className="res-run" onClick={() => run()}>
              <Play size={13} aria-hidden />
              Run simulation
            </button>
          </div>
        ) : effective.length === 0 ? (
          <div className="res-empty">
            <ChartLine size={26} strokeWidth={1.75} aria-hidden />
            <h3>Nothing plotted</h3>
            <p>Select a series above to see it here.</p>
          </div>
        ) : tab === "graph" && layout === "phase" ? (
          <div className="res-phase-wrap">
            <div className="res-phase-axes">
              <label>
                X
                <select value={phasePair.xName} onChange={(event) => setPhaseX(event.target.value)}>
                  {available.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Y
                <select value={phasePair.yName} onChange={(event) => setPhaseY(event.target.value)}>
                  {available.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {phasePair.xName && phasePair.yName ? (
              <PhasePlot
                time={result.time}
                x={{ name: phasePair.xName, values: result.series[phasePair.xName] ?? [] }}
                y={{ name: phasePair.yName, values: result.series[phasePair.yName] ?? [] }}
                color={colors.get(phasePair.yName) ?? theme.muted}
                theme={theme}
                timeUnits={model.run.timeUnits}
              />
            ) : (
              <p className="res-muted">A phase plot needs two series.</p>
            )}
          </div>
        ) : tab === "graph" && layout === "panels" ? (
          <div className="res-panels">
            {chartSeries.map((s) => (
              <div key={s.name} className="res-panel">
                <UPlotChart
                  time={result.time}
                  series={[s]}
                  theme={theme}
                  timeUnits={model.run.timeUnits}
                  yLog={yLog}
                  syncKey="res-panels"
                />
              </div>
            ))}
          </div>
        ) : tab === "graph" ? (
          <UPlotChart
            time={result.time}
            series={chartSeries}
            theme={theme}
            timeUnits={model.run.timeUnits}
            yLog={yLog}
          />
        ) : (
          <ResultsTable
            time={result.time}
            columns={effective.map((name) => ({
              name,
              color: colors.get(name) ?? theme.muted,
              values: result.series[name] ?? [],
            }))}
            timeUnits={model.run.timeUnits}
          />
        )}
      </div>
    </section>
  );
}
