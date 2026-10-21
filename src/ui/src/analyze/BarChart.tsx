/**
 * SourceSink — horizontal SVG bars for sensitivity indices.
 *
 * One group per parameter; each group may have several bars (Sobol S1/ST) and
 * optional low/high confidence whiskers plus a thin marker (Morris σ). Colors
 * are passed in (usually CSS variables or the chart palette), so the chart
 * follows the theme without a canvas.
 */

import { formatNumber } from "../results/csv.js";

export interface BarValue {
  key: string;
  value: number;
  color: string;
  low?: number;
  high?: number;
  /** Thin vertical marker at this value (Morris σ). */
  marker?: number;
}

export interface BarGroup {
  label: string;
  values: BarValue[];
  /** Accessible summary; defaults to label + formatted values. */
  title?: string;
}

export interface BarChartProps {
  groups: BarGroup[];
  ariaLabel: string;
  /** Short legend entries shown under the chart. */
  legend?: Array<{ label: string; color: string; marker?: boolean }>;
}

const WIDTH = 620;
const LABEL_WIDTH = 148;
const BAR_AREA = 430;
const GROUP_PAD = 6;

function labelFor(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

export function BarChart({ groups, ariaLabel, legend }: BarChartProps) {
  const values = groups.flatMap((g) => g.values);
  const finite = values.flatMap((v) => {
    const out = [v.value];
    if (v.marker !== undefined) out.push(v.marker);
    if (v.low !== undefined) out.push(v.low);
    if (v.high !== undefined) out.push(v.high);
    return out.filter((n) => Number.isFinite(n));
  });
  const domainMin = Math.min(0, ...finite);
  const domainMax = Math.max(1e-12, ...finite);
  const span = domainMax - domainMin || 1;
  const x = (value: number): number =>
    LABEL_WIDTH + ((Math.max(domainMin, Math.min(domainMax, value)) - domainMin) / span) * BAR_AREA;

  const maxBars = Math.max(1, ...groups.map((g) => g.values.length));
  const rowHeight = Math.max(24, maxBars * 13 + GROUP_PAD * 2 + 4);
  const height = Math.max(rowHeight, groups.length * rowHeight + 24);
  const zero = x(0);

  return (
    <div className="ana-bars">
      <svg
        className="ana-bars-svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMinYMin meet"
      >
        <line
          x1={zero}
          x2={zero}
          y1={4}
          y2={height - 20}
          className="ana-bars-axis"
        />
        {groups.map((group, gi) => {
          const top = gi * rowHeight + 4;
          const center = top + rowHeight / 2;
          const title =
            group.title ??
            group.values.map((v) => `${v.key}: ${formatNumber(v.value)}`).join(", ");
          return (
            <g key={group.label}>
              <title>{`${group.label} — ${title}`}</title>
              <text x={0} y={center} className="ana-bars-label" dominantBaseline="middle">
                {labelFor(group.label)}
              </text>
              {group.values.map((value, vi) => {
                const y = center - ((group.values.length - 1) * 13) / 2 + vi * 13 - 4;
                const left = Math.min(zero, x(value.value));
                const width = Math.abs(x(value.value) - zero);
                return (
                  <g key={value.key}>
                    {value.low !== undefined && value.high !== undefined ? (
                      <>
                        <line
                          x1={x(value.low)}
                          x2={x(value.high)}
                          y1={y + 4}
                          y2={y + 4}
                          className="ana-bars-whisker"
                          style={{ stroke: value.color }}
                        />
                        <line
                          x1={x(value.low)}
                          x2={x(value.low)}
                          y1={y}
                          y2={y + 8}
                          className="ana-bars-whisker"
                          style={{ stroke: value.color }}
                        />
                        <line
                          x1={x(value.high)}
                          x2={x(value.high)}
                          y1={y}
                          y2={y + 8}
                          className="ana-bars-whisker"
                          style={{ stroke: value.color }}
                        />
                      </>
                    ) : null}
                    {Number.isFinite(value.value) ? (
                      <rect
                        x={left}
                        y={y}
                        width={Math.max(1, width)}
                        height={8}
                        rx={2}
                        style={{ fill: value.color }}
                      />
                    ) : null}
                    {value.marker !== undefined && Number.isFinite(value.marker) ? (
                      <line
                        x1={x(value.marker)}
                        x2={x(value.marker)}
                        y1={y - 2}
                        y2={y + 10}
                        className="ana-bars-marker"
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={zero} y={height - 6} className="ana-bars-tick" textAnchor="middle">
          0
        </text>
        <text
          x={LABEL_WIDTH + BAR_AREA}
          y={height - 6}
          className="ana-bars-tick"
          textAnchor="end"
        >
          {formatNumber(domainMax)}
        </text>
      </svg>
      {legend && legend.length > 0 ? (
        <div className="ana-bars-legend">
          {legend.map((entry) => (
            <span key={entry.label} className="ana-bars-legend-item">
              <span
                className={entry.marker ? "ana-bars-legend-marker" : "ana-bars-legend-swatch"}
                style={entry.marker ? { background: entry.color } : { background: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
