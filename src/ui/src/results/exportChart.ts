/**
 * SourceSink — publication-style chart export.
 *
 * Renders a line chart straight to a standalone SVG string (axes, nice ticks,
 * optional log scales, shaded bands, legend, title), independent of what is
 * on screen, so exports look the same whatever the window size or theme.
 * PNG export rasterizes that SVG at 2x. Pure apart from the download and
 * rasterize helpers at the bottom.
 */

import { formatNumber } from "./csv.js";

export interface ExportSeries {
  name: string;
  color: string;
  values: readonly (number | null)[];
  /** Own x values (a phase plot); defaults to the chart's shared `x`. */
  x?: readonly (number | null)[];
  width?: number;
  dash?: number[];
  /** Hide from the legend (e.g. one line of a large family). */
  legend?: boolean;
  /** Dots instead of a line (observations). */
  points?: boolean;
  /** Mark the first point (open circle) and the last (filled): the
   * direction of time on a phase plot. */
  endpoints?: boolean;
}

export interface ExportBand {
  lower: readonly (number | null)[];
  upper: readonly (number | null)[];
  fill: string;
}

export interface ExportChartSpec {
  title?: string;
  subtitle?: string;
  x: readonly number[];
  series: ExportSeries[];
  bands?: ExportBand[];
  xLabel?: string;
  yLabel?: string;
  xLog?: boolean;
  yLog?: boolean;
  width?: number;
  height?: number;
  /** On-screen colours; exports use the light defaults. */
  colors?: Partial<ChartColors>;
}

export interface ChartColors {
  background: string;
  ink: string;
  muted: string;
  grid: string;
  frame: string;
}

const LIGHT: ChartColors = { background: "#ffffff", ink: "#111827", muted: "#5f6776", grid: "#e5e7eb", frame: "#9ca3af" };

const FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";
const INK = "#111827";
const MUTED = "#5f6776";

/** About `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; first + i * step <= max + step * 1e-9; i += 1) {
    const v = Number((first + i * step).toPrecision(12));
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/** Powers of ten across [min, max] (min > 0), with 2 and 5 between them when
 * the range covers two decades or fewer. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const fine = hi - lo <= 2;
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e += 1) {
    for (const m of fine ? [1, 2, 5] : [1]) {
      const v = m * 10 ** e;
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) ticks.push(v);
    }
  }
  return ticks;
}

/** Extend evenly spaced ticks by one step at either end so they enclose the
 * data: the axis then ends on a round number. */
function coverTicks(ticks: number[], [lo, hi]: [number, number]): number[] {
  if (ticks.length < 2) return ticks;
  const step = ticks[1] - ticks[0];
  const out = ticks.slice();
  if (out[0] > lo + step * 1e-9) out.unshift(Number((out[0] - step).toPrecision(12)));
  if (out[out.length - 1] < hi - step * 1e-9) out.push(Number((out[out.length - 1] + step).toPrecision(12)));
  return out;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function extent(values: Iterable<number | null | undefined>, log: boolean): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v == null || !Number.isFinite(v) || (log && v <= 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Plot area and value-to-pixel mappings of a chart. */
export interface ChartGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  bottom: number;
  xTicks: number[];
  yTicks: number[];
  fx: (v: number) => number;
  fy: (v: number) => number;
  /** True when (x, y) can be drawn (finite, positive on log axes). */
  ok: (x: number | null | undefined, y: number | null | undefined) => boolean;
  legendItems: ExportSeries[];
}

export function chartGeometry(spec: ExportChartSpec): ChartGeometry {
  const width = spec.width ?? 1200;
  const height = spec.height ?? 700;
  const legendItems = spec.series.filter((s) => s.legend !== false);
  const legendRows = Math.ceil(legendItems.length / Math.max(1, Math.floor((width - 120) / 190)));
  const top = (spec.title ? 46 : 20) + (spec.subtitle ? 20 : 0);
  const bottom = 64 + (legendItems.length > 0 ? 14 + legendRows * 22 : 0);
  const left = 86;
  const right = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const xs = spec.series.flatMap((s) => Array.from(s.x ?? spec.x));
  const ys = [
    ...spec.series.flatMap((s) => Array.from(s.values)),
    ...(spec.bands ?? []).flatMap((b) => [...b.lower, ...b.upper]),
  ];
  const xr = extent(xs, Boolean(spec.xLog)) ?? [0, 1];
  let yr = extent(ys, Boolean(spec.yLog)) ?? [0, 1];
  if (!spec.yLog && yr[0] > 0 && yr[0] < yr[1] * 0.25) yr = [0, yr[1]];

  const xTicks = spec.xLog ? logTicks(xr[0], xr[1]) : coverTicks(niceTicks(xr[0], xr[1], 8), xr);
  const yTicks = spec.yLog ? logTicks(yr[0], yr[1]) : coverTicks(niceTicks(yr[0], yr[1], 6), yr);
  const [x0, x1] = spec.xLog ? xr : [Math.min(xr[0], xTicks[0] ?? xr[0]), Math.max(xr[1], xTicks.at(-1) ?? xr[1])];
  const [y0, y1] = spec.yLog ? yr : [Math.min(yr[0], yTicks[0] ?? yr[0]), Math.max(yr[1], yTicks.at(-1) ?? yr[1])];

  const fx = (v: number) => {
    const t = spec.xLog ? (Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0) || 1) : (v - x0) / (x1 - x0 || 1);
    return left + t * plotW;
  };
  const fy = (v: number) => {
    const t = spec.yLog ? (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0) || 1) : (v - y0) / (y1 - y0 || 1);
    return top + plotH - t * plotH;
  };
  const ok = (x: number | null | undefined, y: number | null | undefined) =>
    x != null && y != null && Number.isFinite(x) && Number.isFinite(y) && (!spec.xLog || x > 0) && (!spec.yLog || y > 0);
  return { width, height, left, top, plotW, plotH, bottom, xTicks, yTicks, fx, fy, ok, legendItems };
}

/** Build the chart as a standalone SVG document. */
export function chartSvg(spec: ExportChartSpec): string {
  const { width, height, left, top, plotW, plotH, bottom, xTicks, yTicks, fx, fy, ok, legendItems } = chartGeometry(spec);
  const { background, ink: INK, muted: MUTED, grid: GRID, frame } = { ...LIGHT, ...spec.colors };

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
  );
  if (spec.title) out.push(`<text x="${left}" y="30" font-size="20" font-weight="600" fill="${INK}">${escapeXml(spec.title)}</text>`);
  if (spec.subtitle)
    out.push(`<text x="${left}" y="${spec.title ? 52 : 30}" font-size="13" fill="${MUTED}">${escapeXml(spec.subtitle)}</text>`);

  // grid and ticks
  for (const t of yTicks) {
    const y = fy(t).toFixed(1);
    out.push(`<line x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}" stroke="${GRID}"/>`);
    out.push(`<text x="${left - 10}" y="${y}" font-size="13" fill="${MUTED}" text-anchor="end" dominant-baseline="middle">${escapeXml(formatNumber(t))}</text>`);
  }
  for (const t of xTicks) {
    const x = fx(t).toFixed(1);
    out.push(`<line x1="${x}" x2="${x}" y1="${top}" y2="${top + plotH}" stroke="${GRID}"/>`);
    out.push(`<text x="${x}" y="${top + plotH + 22}" font-size="13" fill="${MUTED}" text-anchor="middle">${escapeXml(formatNumber(t))}</text>`);
  }
  out.push(`<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="none" stroke="${frame}"/>`);
  if (spec.xLabel)
    out.push(`<text x="${left + plotW / 2}" y="${top + plotH + 48}" font-size="14" fill="${INK}" text-anchor="middle">${escapeXml(spec.xLabel)}</text>`);
  if (spec.yLabel)
    out.push(
      `<text transform="translate(22 ${top + plotH / 2}) rotate(-90)" font-size="14" fill="${INK}" text-anchor="middle">${escapeXml(spec.yLabel)}</text>`,
    );

  out.push(`<defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}"/></clipPath></defs>`);
  out.push(`<g clip-path="url(#plot)">`);
  for (const band of spec.bands ?? []) {
    const upper: string[] = [];
    const lower: string[] = [];
    spec.x.forEach((x, i) => {
      if (ok(x, band.upper[i]) && ok(x, band.lower[i])) {
        upper.push(`${fx(x).toFixed(2)},${fy(band.upper[i]!).toFixed(2)}`);
        lower.unshift(`${fx(x).toFixed(2)},${fy(band.lower[i]!).toFixed(2)}`);
      }
    });
    if (upper.length > 1) out.push(`<polygon points="${[...upper, ...lower].join(" ")}" fill="${band.fill}" stroke="none"/>`);
  }
  for (const s of spec.series) {
    const sx = s.x ?? spec.x;
    const segments: string[][] = [[]];
    s.values.forEach((y, i) => {
      const x = sx[i];
      if (ok(x, y)) segments[segments.length - 1].push(`${fx(x!).toFixed(2)},${fy(y!).toFixed(2)}`);
      else if (segments[segments.length - 1].length > 0) segments.push([]);
    });
    if (s.points) {
      s.values.forEach((y, i) => {
        const x = sx[i];
        if (ok(x, y)) out.push(`<circle cx="${fx(x!).toFixed(2)}" cy="${fy(y!).toFixed(2)}" r="4" fill="${s.color}"/>`);
      });
      continue;
    }
    const dash = s.dash ? ` stroke-dasharray="${s.dash.join(" ")}"` : "";
    for (const points of segments.filter((p) => p.length > 0)) {
      out.push(
        `<polyline points="${points.join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2.25}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`,
      );
    }
    if (s.endpoints) {
      const flat = segments.flat();
      if (flat.length > 0) {
        const [sx0, sy0] = flat[0].split(",");
        const [sx1, sy1] = flat[flat.length - 1].split(",");
        out.push(`<circle cx="${sx0}" cy="${sy0}" r="5.5" fill="#ffffff" stroke="${s.color}" stroke-width="2"/>`);
        out.push(`<circle cx="${sx1}" cy="${sy1}" r="5.5" fill="${s.color}"/>`);
      }
    }
  }
  out.push(`</g>`);

  // legend
  if (legendItems.length > 0) {
    const perRow = Math.max(1, Math.floor((width - 120) / 190));
    legendItems.forEach((s, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const x = left + col * 190;
      const y = height - bottom + 78 + row * 22;
      out.push(
        s.points
          ? `<circle cx="${x + 11}" cy="${y - 4}" r="4" fill="${s.color}"/>`
          : `<line x1="${x}" x2="${x + 22}" y1="${y - 4}" y2="${y - 4}" stroke="${s.color}" stroke-width="3"/>`,
      );
      out.push(`<text x="${x + 30}" y="${y}" font-size="13" fill="${INK}">${escapeXml(s.name)}</text>`);
    });
  }
  out.push(`</svg>`);
  return out.join("\n");
}

/** A file-system friendly base name. */
export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "chart";
}

// ----- browser helpers -------------------------------------------------------

/** Resolve `var(--token)` colors against the page so the SVG stands alone. */
export function resolveColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color.trim());
  if (!match || typeof document === "undefined") return color;
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || color;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterize an SVG document to a PNG blob at `scale` × its size. */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("canvas is not available"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not render the chart image"));
    };
    image.src = url;
  });
}

/** Download `spec` as `<base>.svg` or `<base>.png`. */
export async function exportChart(spec: ExportChartSpec, format: "svg" | "png", base: string): Promise<void> {
  const resolved: ExportChartSpec = {
    ...spec,
    series: spec.series.map((s) => ({ ...s, color: resolveColor(s.color) })),
    bands: spec.bands?.map((b) => ({ ...b, fill: resolveColor(b.fill) })),
  };
  const svg = chartSvg(resolved);
  const name = safeFileName(base);
  if (format === "svg") {
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
    return;
  }
  const png = await svgToPng(svg, resolved.width ?? 1200, resolved.height ?? 700, 2);
  downloadBlob(png, `${name}.png`);
}

// ----- heat maps -------------------------------------------------------------

/** Viridis stops (perceptually uniform, colour-blind safe). */
const VIRIDIS = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];

/** Colour for t in [0, 1] on the viridis scale. */
export function viridis(t: number): string {
  if (!Number.isFinite(t)) return "#d1d5db";
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = Number.parseInt(VIRIDIS[i].slice(1), 16);
  const b = Number.parseInt(VIRIDIS[i + 1].slice(1), 16);
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("")}`;
}

export interface HeatmapSpec {
  title?: string;
  subtitle?: string;
  /** Levels along x (columns) and y (rows). */
  x: readonly number[];
  y: readonly number[];
  /** `values[yi * x.length + xi]`; NaN for missing cells. */
  values: readonly number[];
  xLabel: string;
  yLabel: string;
  valueLabel: string;
  xLog?: boolean;
  yLog?: boolean;
  width?: number;
  height?: number;
  /** Outline this cell (hover highlight on screen). */
  highlight?: { xi: number; yi: number };
}

export interface HeatmapLayout {
  width: number;
  height: number;
  left: number;
  top: number;
  plotW: number;
  plotH: number;
}

function tickIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

/** A heat map of a 2-D sweep, as a standalone SVG plus its plot geometry. */
export function heatmapSvg(spec: HeatmapSpec): { svg: string; layout: HeatmapLayout } {
  const width = spec.width ?? 1000;
  const height = spec.height ?? 720;
  const top = (spec.title ? 46 : 20) + (spec.subtitle ? 20 : 0);
  const left = 96;
  const right = 120;
  const bottom = 70;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const nx = spec.x.length;
  const ny = spec.y.length;
  const finite = spec.values.filter(Number.isFinite);
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 1;
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const cw = plotW / Math.max(1, nx);
  const ch = plotH / Math.max(1, ny);

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ];
  if (spec.title) out.push(`<text x="${left}" y="30" font-size="20" font-weight="600" fill="${INK}">${escapeXml(spec.title)}</text>`);
  if (spec.subtitle)
    out.push(`<text x="${left}" y="${spec.title ? 52 : 30}" font-size="13" fill="${MUTED}">${escapeXml(spec.subtitle)}</text>`);

  for (let yi = 0; yi < ny; yi += 1) {
    for (let xi = 0; xi < nx; xi += 1) {
      const v = spec.values[yi * nx + xi];
      // rows run bottom (first level) to top (last level)
      const x = left + xi * cw;
      const y = top + plotH - (yi + 1) * ch;
      out.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cw + 0.5).toFixed(2)}" height="${(ch + 0.5).toFixed(2)}" fill="${viridis(Number.isFinite(v) ? norm(v) : Number.NaN)}"/>`,
      );
    }
  }
  if (spec.highlight) {
    const { xi, yi } = spec.highlight;
    out.push(
      `<rect x="${(left + xi * cw).toFixed(2)}" y="${(top + plotH - (yi + 1) * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" fill="none" stroke="#ffffff" stroke-width="2.5"/>`,
    );
  }
  out.push(`<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="none" stroke="#9ca3af"/>`);

  for (const xi of tickIndices(nx)) {
    const x = left + (xi + 0.5) * cw;
    out.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top + plotH}" y2="${top + plotH + 5}" stroke="#9ca3af"/>`);
    out.push(`<text x="${x.toFixed(1)}" y="${top + plotH + 22}" font-size="13" fill="${MUTED}" text-anchor="middle">${escapeXml(formatNumber(spec.x[xi]))}</text>`);
  }
  for (const yi of tickIndices(ny)) {
    const y = top + plotH - (yi + 0.5) * ch;
    out.push(`<line x1="${left - 5}" x2="${left}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#9ca3af"/>`);
    out.push(`<text x="${left - 10}" y="${y.toFixed(1)}" font-size="13" fill="${MUTED}" text-anchor="end" dominant-baseline="middle">${escapeXml(formatNumber(spec.y[yi]))}</text>`);
  }
  const logNote = (log?: boolean) => (log ? " (log scale)" : "");
  out.push(`<text x="${left + plotW / 2}" y="${top + plotH + 50}" font-size="14" fill="${INK}" text-anchor="middle">${escapeXml(spec.xLabel + logNote(spec.xLog))}</text>`);
  out.push(
    `<text transform="translate(24 ${top + plotH / 2}) rotate(-90)" font-size="14" fill="${INK}" text-anchor="middle">${escapeXml(spec.yLabel + logNote(spec.yLog))}</text>`,
  );

  // colour bar
  const barX = left + plotW + 28;
  const barW = 18;
  const stops = VIRIDIS.map((c, i) => `<stop offset="${(i / (VIRIDIS.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join("");
  out.push(`<defs><linearGradient id="cbar" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient></defs>`);
  out.push(`<rect x="${barX}" y="${top}" width="${barW}" height="${plotH}" fill="url(#cbar)" stroke="#9ca3af"/>`);
  for (const t of niceTicks(lo, hi, 6).filter((v) => v >= lo - 1e-12 && v <= hi + 1e-12)) {
    const y = top + plotH - norm(t) * plotH;
    out.push(`<text x="${barX + barW + 6}" y="${y.toFixed(1)}" font-size="12" fill="${MUTED}" dominant-baseline="middle">${escapeXml(formatNumber(t))}</text>`);
  }
  out.push(
    `<text transform="translate(${width - 12} ${top + plotH / 2}) rotate(-90)" font-size="13" fill="${INK}" text-anchor="middle">${escapeXml(spec.valueLabel)}</text>`,
  );
  out.push(`</svg>`);
  return { svg: out.join("\n"), layout: { width, height, left, top, plotW, plotH } };
}

/** Download a heat map as SVG or PNG. */
export async function exportHeatmap(spec: HeatmapSpec, format: "svg" | "png", base: string): Promise<void> {
  const { svg, layout } = heatmapSvg({ ...spec, highlight: undefined });
  const name = safeFileName(base);
  if (format === "svg") {
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
    return;
  }
  downloadBlob(await svgToPng(svg, layout.width, layout.height, 2), `${name}.png`);
}
