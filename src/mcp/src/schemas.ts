/**
 * Input schemas for the SourceSink MCP tools.
 *
 * The same raw shapes are handed to the SDK (which converts them to JSON
 * Schema for `tools/list`) and wrapped in strict objects for the
 * transport-independent core, so direct calls and MCP calls validate alike.
 */

import { z } from "zod";

const idShape = { id: z.string().min(1) };

const runShape = {
  start: z.number().optional(),
  stop: z.number().optional(),
  dt: z.number().optional(),
  saveEvery: z.number().optional(),
  integration: z.enum(["euler", "rk2", "rk4", "rk45"]).optional(),
  timeUnits: z.string().optional(),
  dtUnits: z.string().optional(),
};

const seriesShape = { series: z.array(z.string().min(1)).optional() };

export const createShape = {
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  xmile: z.string().min(1).optional(),
};

export const openShape = { path: z.string().min(1) };

export const getShape = { ...idShape };

export const patchShape = {
  id: z.string().min(1),
  // The patch is validated op-by-op by the patch package's schema stage; the
  // SDK only needs to know it is a JSON object.
  patch: z.record(z.string(), z.unknown()),
  dryRun: z.boolean().optional(),
};

export const validateShape = { ...idShape };

export const simulateShape = {
  ...idShape,
  run: z.object(runShape).optional(),
  seed: z.number().optional(),
  ...seriesShape,
  every: z.number().int().positive().optional(),
};

export const ensembleShape = {
  ...idShape,
  samples: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).optional(),
  grid: z.record(z.string(), z.array(z.number())).optional(),
  ranges: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
  n: z.number().int().positive().optional(),
  lhs: z.boolean().optional(),
  seed: z.number().optional(),
  ...seriesShape,
};

export const explainShape = { ...idShape };

export const exportShape = {
  ...idShape,
  format: z.enum(["xmile", "json"]),
};

export const historyShape = { ...idShape };

const parameterSchema = z
  .object({
    name: z.string().min(1),
    min: z.number(),
    max: z.number(),
    initial: z.number().optional(),
    scale: z.enum(["linear", "log"]).optional(),
  })
  .refine((p) => p.max >= p.min, { message: "max must be >= min", path: ["max"] });

const dataSchema = z
  .object({
    csv: z.string().min(1).optional(),
    time: z.array(z.number()).optional(),
    series: z.record(z.string(), z.array(z.number())).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCsv = data.csv !== undefined;
    const hasArrays = data.time !== undefined || data.series !== undefined;
    if (hasCsv === hasArrays) {
      ctx.addIssue({
        code: "custom",
        message: "provide either 'csv' or both 'time' and 'series'",
      });
      return;
    }
    if (!hasCsv) {
      if (data.time === undefined || data.series === undefined) {
        ctx.addIssue({ code: "custom", message: "provide both 'time' and 'series'" });
        return;
      }
      for (const [name, values] of Object.entries(data.series)) {
        if (values.length !== data.time.length) {
          ctx.addIssue({
            code: "custom",
            path: ["series", name],
            message: `series '${name}' has ${values.length} values but time has ${data.time.length}`,
          });
        }
      }
    }
  });

const calibrationOptionsSchema = z.object({
  method: z.enum(["nelder-mead", "differential-evolution"]).optional(),
  objective: z.enum(["sse", "wsse", "nse"]).optional(),
  starts: z.number().int().positive().optional(),
  maxEvaluations: z.number().int().positive().optional(),
  tolerance: z.number().positive().optional(),
  seed: z.number().optional(),
});

const outputMetricSchema = z.union([
  z.object({
    series: z.string().min(1),
    stat: z.enum(["final", "max", "min", "mean", "integral"]),
  }),
  z.object({ series: z.string().min(1), stat: z.literal("at"), time: z.number() }),
]);

export const calibrateShape = {
  ...idShape,
  data: dataSchema,
  params: z.array(parameterSchema).min(1),
  options: calibrationOptionsSchema.optional(),
  apply: z.boolean().optional(),
};

export const sensitivityShape = {
  ...idShape,
  params: z.array(parameterSchema).min(1),
  metric: outputMetricSchema,
  method: z.enum(["morris", "sobol"]).optional(),
  samples: z.number().int().positive().optional(),
  trajectories: z.number().int().positive().optional(),
  seed: z.number().optional(),
};

export const createSchema = z.object(createShape);
export const openSchema = z.object(openShape);
export const getSchema = z.object(getShape);
export const patchSchema = z.object(patchShape);
export const validateSchema = z.object(validateShape);
export const simulateSchema = z.object(simulateShape);
export const ensembleSchema = z.object(ensembleShape);
export const explainSchema = z.object(explainShape);
export const exportSchema = z.object(exportShape);
export const historySchema = z.object(historyShape);
export const calibrateSchema = z.object(calibrateShape);
export const sensitivitySchema = z.object(sensitivityShape);

export type CreateInput = z.infer<typeof createSchema>;
export type OpenInput = z.infer<typeof openSchema>;
export type PatchInput = z.infer<typeof patchSchema>;
export type SimulateInput = z.infer<typeof simulateSchema>;
export type EnsembleInput = z.infer<typeof ensembleSchema>;
export type ExportInput = z.infer<typeof exportSchema>;
export type CalibrateInput = z.infer<typeof calibrateSchema>;
export type SensitivityInput = z.infer<typeof sensitivitySchema>;
