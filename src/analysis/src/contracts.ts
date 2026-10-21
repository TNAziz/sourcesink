/**
 * SourceSink — shared types for calibration and sensitivity analysis
 * (see docs/analysis.md). Implementations live in data.ts, calibrate.ts,
 * optimize.ts, sensitivity.ts and sobol.ts.
 */

/** A bounded model parameter to fit or vary. `name` is an element name
 * (stock: its initial value; flow/converter: its equation, replaced by a
 * constant). `scale: "log"` searches/samples log-uniformly (min must be > 0). */
export interface ParameterSpec {
  name: string;
  min: number;
  max: number;
  /** Starting point for local optimizers; default: the element's current
   * constant value when it has one, else the middle of the range. */
  initial?: number;
  scale?: "linear" | "log";
}

/** Observed data: one time axis and one or more series named after model
 * elements. Missing observations are NaN. */
export interface Dataset {
  time: number[];
  series: Record<string, number[]>;
  /** Optional weight per series in the objective (default 1). */
  weights?: Record<string, number>;
}

/** Model output paired with observations at the observation times. */
export interface Alignment {
  series: string;
  time: number[];
  observed: number[];
  simulated: number[];
}

/** Calibration objective. "sse": sum of squared errors; "wsse": each
 * series' SSE divided by its observed variance (so series in different
 * units weigh alike), times its weight; "nse": 1 − Nash-Sutcliffe
 * efficiency summed over series (0 is a perfect fit). */
export type ObjectiveKind = "sse" | "wsse" | "nse";

/** Goodness of fit for one series. */
export interface FitMetrics {
  n: number;
  sse: number;
  rmse: number;
  /** Nash-Sutcliffe efficiency (1 = perfect, 0 = no better than the mean). */
  nse: number;
  /** Squared Pearson correlation. */
  r2: number;
  /** Mean of simulated − observed. */
  bias: number;
}

export interface CalibrationOptions {
  method?: "nelder-mead" | "differential-evolution";
  objective?: ObjectiveKind;
  /** Nelder-Mead restarts from Latin-hypercube points (default 1 = only the
   * initial point). */
  starts?: number;
  maxEvaluations?: number;
  /** Relative objective tolerance for convergence (default 1e-8). */
  tolerance?: number;
  seed?: number;
}

/** Local identifiability at the optimum, from the finite-difference Jacobian
 * of the residuals (J): covariance ≈ s²·(JᵀJ)⁻¹ with s² = SSE/(n − p). */
export interface Identifiability {
  parameters: string[];
  standardErrors: Record<string, number>;
  /** Correlation matrix in `parameters` order. */
  correlation: number[][];
  /** Plain-language warnings, e.g. "K and r are strongly correlated (0.97)",
   * "theta has almost no effect on the fit (standard error > 10 × range)". */
  warnings: string[];
}

export interface FitResult {
  method: string;
  parameters: Record<string, number>;
  objective: number;
  evaluations: number;
  converged: boolean;
  /** Per-series alignment and metrics at the best parameters. */
  alignments: Alignment[];
  metrics: Record<string, FitMetrics>;
  identifiability: Identifiability;
  /** Best objective after each evaluation batch, for a convergence plot. */
  history: number[];
}

/** How one run is reduced to a single number for sensitivity analysis. */
export type OutputMetric =
  | { series: string; stat: "final" | "max" | "min" | "mean" | "integral" }
  | { series: string; stat: "at"; time: number };

export interface MorrisResult {
  metric: OutputMetric;
  /** Sorted by muStar, largest first. */
  parameters: Array<{ name: string; mu: number; muStar: number; sigma: number }>;
  evaluations: number;
  failed: number;
}

export interface SobolResult {
  metric: OutputMetric;
  /** Sorted by total, largest first. CIs are bootstrap 95% intervals. */
  parameters: Array<{
    name: string;
    first: number;
    total: number;
    firstCI: [number, number];
    totalCI: [number, number];
  }>;
  evaluations: number;
  failed: number;
  /** Variance of the metric over the base samples. */
  variance: number;
}
