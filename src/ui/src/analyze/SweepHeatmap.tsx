/**
 * SourceSink — heat map of a two-parameter sweep. The picture is the same SVG
 * the export writes (`heatmapSvg`), so what you see is what you download;
 * hovering a cell shows its parameter values and output.
 */

import { useMemo, useRef, useState } from "react";

import type { SweepResult } from "@sourcesink/analysis";

import { formatNumber } from "../results/csv.js";
import { exportHeatmap, heatmapSvg, type HeatmapSpec } from "../results/exportChart.js";
import { ExportMenu } from "../results/ExportMenu.js";

export function SweepHeatmap({ result, metricLabel }: { result: SweepResult; metricLabel: string }) {
  const [a, b] = result.axes;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ xi: number; yi: number } | null>(null);

  // first axis across, second axis up; outputs are row-major over the first axis
  const spec: HeatmapSpec = useMemo(() => {
    const values: number[] = [];
    for (let j = 0; j < b.values.length; j += 1) {
      for (let i = 0; i < a.values.length; i += 1) values.push(result.outputs[i * b.values.length + j]);
    }
    return {
      x: a.values,
      y: b.values,
      values,
      xLabel: a.name,
      yLabel: b.name,
      valueLabel: metricLabel,
      xLog: a.scale === "log",
      yLog: b.scale === "log",
      width: 760,
      height: 520,
    };
  }, [a, b, result.outputs, metricLabel]);

  const { svg, layout } = useMemo(() => heatmapSvg({ ...spec, highlight: hover ?? undefined }), [spec, hover]);

  const onMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const scale = box.width / layout.width;
    const px = (event.clientX - box.left) / scale - layout.left;
    const py = (event.clientY - box.top) / scale - layout.top;
    if (px < 0 || py < 0 || px >= layout.plotW || py >= layout.plotH) {
      setHover(null);
      return;
    }
    const xi = Math.floor((px / layout.plotW) * a.values.length);
    const yi = b.values.length - 1 - Math.floor((py / layout.plotH) * b.values.length);
    setHover((h) => (h && h.xi === xi && h.yi === yi ? h : { xi, yi }));
  };

  const hovered = hover ? spec.values[hover.yi * a.values.length + hover.xi] : undefined;

  return (
    <figure className="ana-chart">
      <figcaption className="ana-chart-head">
        <span className="ana-chart-title">
          {metricLabel} over {a.name} and {b.name}
        </span>
        <ExportMenu
          className="ana-export"
          formats={["png", "svg"]}
          onExport={(format) =>
            exportHeatmap(
              { ...spec, title: `${metricLabel} over ${a.name} and ${b.name}`, width: 1000, height: 720 },
              format === "svg" ? "svg" : "png",
              `sweep-${a.name}-${b.name}-${metricLabel}`,
            )
          }
        />
      </figcaption>
      <div
        ref={ref}
        className="ana-heatmap"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        // The SVG is generated locally from numbers and escaped labels.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hover ? (
        <div className="ana-readout">
          <span className="ana-readout-time">
            {a.name} = {formatNumber(a.values[hover.xi])}, {b.name} = {formatNumber(b.values[hover.yi])}
          </span>
          <span className="ana-readout-item">
            {metricLabel}: {hovered === undefined || !Number.isFinite(hovered) ? "run failed" : formatNumber(hovered)}
          </span>
        </div>
      ) : (
        <div className="ana-chart-note">Hover a cell to read its values. Yellow is high, purple is low.</div>
      )}
    </figure>
  );
}
