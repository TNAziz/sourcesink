/**
 * SourceSink — phase plot: one series against another, with time running
 * along the curve from the open circle to the filled one. Drawn with the
 * export renderer in the live theme's colours and sized to its container;
 * hovering snaps to the nearest saved point.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { formatNumber } from "./csv";
import { chartGeometry, chartSvg, type ExportChartSpec } from "./exportChart";
import type { ChartTheme } from "./useChartTheme";

export interface PhasePlotProps {
  time: readonly number[];
  x: { name: string; values: readonly number[] };
  y: { name: string; values: readonly number[] };
  color: string;
  theme: ChartTheme;
  timeUnits?: string;
}

/** The spec both the screen and the export draw. */
export function phaseSpec(props: Omit<PhasePlotProps, "theme">, size?: { width: number; height: number }): ExportChartSpec {
  return {
    x: props.time,
    xLabel: props.x.name,
    yLabel: props.y.name,
    width: size?.width,
    height: size?.height,
    series: [
      {
        name: `${props.y.name} against ${props.x.name}`,
        color: props.color,
        x: props.x.values,
        values: props.y.values,
        endpoints: true,
        legend: false,
      },
    ],
  };
}

export function PhasePlot(props: PhasePlotProps) {
  const { time, x, y, theme, timeUnits } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 360 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const width = Math.max(320, Math.round(el.clientWidth));
      const height = Math.max(220, Math.round(el.clientHeight));
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spec = useMemo(
    () => ({
      ...phaseSpec(props, size),
      colors: { background: theme.surface, ink: theme.text, muted: theme.muted, grid: theme.border, frame: theme.border },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [time, x, y, props.color, theme, size],
  );
  const geometry = useMemo(() => chartGeometry(spec), [spec]);
  const svg = useMemo(() => chartSvg(spec), [spec]);

  const onMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = -1;
    let bestD = 24 * 24;
    for (let i = 0; i < time.length; i += 1) {
      if (!geometry.ok(x.values[i], y.values[i])) continue;
      const dx = geometry.fx(x.values[i]) - px;
      const dy = geometry.fy(y.values[i]) - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best >= 0 ? best : null);
  };

  return (
    <div className="res-chartwrap">
      <div
        ref={ref}
        className="res-phase"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        // Generated locally from numbers and escaped labels.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hover !== null ? (
        <div
          className="res-phase-dot"
          style={{ left: geometry.fx(x.values[hover]), top: geometry.fy(y.values[hover]), borderColor: props.color }}
        />
      ) : null}
      <div className="res-phase-readout">
        {hover !== null ? (
          <>
            <b>
              t = {formatNumber(time[hover])}
              {timeUnits ? ` ${timeUnits}` : ""}
            </b>
            <span>
              {x.name} = {formatNumber(x.values[hover])}
            </span>
            <span>
              {y.name} = {formatNumber(y.values[hover])}
            </span>
          </>
        ) : (
          <span>Time runs along the curve from the open circle (start) to the filled one (end). Hover to read a point.</span>
        )}
      </div>
    </div>
  );
}
