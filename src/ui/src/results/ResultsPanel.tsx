/**
 * Results drawer: graph and table views of the last run, a series picker,
 * run metadata and CSV export. Mounted into the shell's bottom drawer and
 * sized entirely by the container; owns nothing outside src/ui/src/results.
 */
import { useMemo, useState } from "react";
import { ChartLine, Download, Play, Table2, TriangleAlert } from "lucide-react";
import { useEditor } from "../state/store";
import { csvFileName, toCsv } from "./csv";
import { seriesColorMap } from "./palette";
import { effectivePlotted, runCaption, seriesNames, togglePlotted } from "./series";
import { ResultsTable } from "./ResultsTable";
import { UPlotChart, type ChartSeries } from "./UPlotChart";
import { useChartTheme } from "./useChartTheme";
import "./results.css";

type Tab = "graph" | "table";

export function ResultsPanel() {
  const result = useEditor((s) => s.result);
  const runError = useEditor((s) => s.runError);
  const plotted = useEditor((s) => s.plotted);
  const model = useEditor((s) => s.model);
  const run = useEditor((s) => s.run);
  const setPlotted = useEditor((s) => s.setPlotted);
  const theme = useChartTheme();
  const [tab, setTab] = useState<Tab>("graph");

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
    const blob = new Blob([toCsv(result, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFileName(model.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      effective.map((name) => ({
        name,
        color: colors.get(name) ?? theme.muted,
        values: result?.series[name] ?? [],
      })),
    [effective, colors, result, theme.muted],
  );

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
        <span className="res-caption">{runCaption(model.run)}</span>
        <button
          type="button"
          className="res-export"
          onClick={exportCsv}
          disabled={result === null}
          title="Download the plotted series as CSV"
        >
          <Download size={13} aria-hidden />
          Export CSV
        </button>
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
        ) : tab === "graph" ? (
          <UPlotChart
            time={result.time}
            series={chartSeries}
            theme={theme}
            timeUnits={model.run.timeUnits}
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
