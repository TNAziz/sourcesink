/**
 * SourceSink — pairing simulation output with observations.
 *
 * Simulated values are linearly interpolated to each observation time; an
 * observation outside the simulated time span, or a NaN on either side, is
 * dropped from the pairing.
 */

import type { SimulationResult } from "@sourcesink/engine";

import type { Alignment, Dataset } from "./contracts.js";

/** Value of a sampled series at time `t` by linear interpolation; NaN
 * outside the sampled span. */
export function interpolateAt(time: number[], values: number[], t: number): number {
  const n = time.length;
  if (n === 0) return Number.NaN;
  const eps = 1e-9 * Math.max(1, Math.abs(t));
  if (t < time[0] - eps || t > time[n - 1] + eps) return Number.NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  if (Math.abs(time[lo] - t) <= eps) return values[lo];
  if (Math.abs(time[hi] - t) <= eps) return values[hi];
  const f = (t - time[lo]) / (time[hi] - time[lo]);
  return values[lo] + f * (values[hi] - values[lo]);
}

/** Pair every observed series with the simulation. Series the simulation
 * does not have throw (a typo in the data's column names should not fit
 * silently). */
export function align(result: SimulationResult, data: Dataset): Alignment[] {
  return Object.entries(data.series).map(([name, obs]) => {
    const sim = result.series[name];
    if (!sim) throw new Error(`observed series '${name}' is not in the model results`);
    const out: Alignment = { series: name, time: [], observed: [], simulated: [] };
    data.time.forEach((t, i) => {
      const o = obs[i];
      const s = interpolateAt(result.time, sim, t);
      if (Number.isFinite(o) && Number.isFinite(s)) {
        out.time.push(t);
        out.observed.push(o);
        out.simulated.push(s);
      }
    });
    return out;
  });
}
