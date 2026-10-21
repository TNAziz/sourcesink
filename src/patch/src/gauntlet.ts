/**
 * The validation gauntlet.
 *
 * A proposed patch is never trusted directly: it is schema-checked, applied to
 * a copy, parsed, structurally validated and finally smoke-simulated. The
 * first stage that produces an error stops the pipeline, so a finding always
 * points at the earliest thing the author needs to fix.
 */

import { parse, simulate } from "@sourcesink/engine";
import { checkUnits } from "@sourcesink/units";
import type { Model } from "@sourcesink/model";

import { applyPatch } from "./apply.js";
import { equationUnits } from "./elements.js";
import { checkPatchSchema } from "./schema.js";
import { structuralFindings } from "./structure.js";
import {
  PatchError,
  type Finding,
  type GauntletResult,
  type ModelPatch,
} from "./types.js";

function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

/** A smoke run is capped at ten integration steps. */
const SMOKE_STEPS = 10;

function smokeFindings(model: Model): Finding[] {
  const { start, stop, dt } = model.run;
  const length = Math.max(0, stop - start);
  const smokeStop = start + Math.min(length, SMOKE_STEPS * dt);
  const findings: Finding[] = [];
  try {
    const result = simulate({ ...model, run: { ...model.run, start, stop: smokeStop } });
    if (result.time.length === 0) {
      return [{ stage: "smoke", severity: "error", message: "smoke run produced no samples" }];
    }
    for (const [name, series] of Object.entries(result.series)) {
      if (series.some((v) => !Number.isFinite(v))) {
        findings.push({
          stage: "smoke",
          severity: "error",
          element: name,
          message: `smoke run produced a non-finite value for '${name}' (division by zero or an undefined function?)`,
        });
      }
    }
  } catch (err) {
    findings.push({
      stage: "smoke",
      severity: "error",
      message: `smoke run failed: ${(err as Error).message}`,
    });
  }
  return findings;
}

/** Validate and apply a patch. `model` is returned whenever the apply stage
 * succeeded, even if a later stage rejected the result, so a reviewer can
 * inspect the candidate. */
export function runGauntlet(model: Model, patch: ModelPatch): GauntletResult {
  const schema = checkPatchSchema(patch);
  if (hasErrors(schema)) return { ok: false, findings: schema };

  let applied: Model;
  try {
    applied = applyPatch(model, patch);
  } catch (err) {
    const op = err instanceof PatchError ? err.op : undefined;
    const name = op && "name" in op && typeof op.name === "string" ? op.name : undefined;
    return {
      ok: false,
      findings: [
        {
          stage: "apply",
          severity: "error",
          element: name,
          message: (err as Error).message,
        },
      ],
    };
  }

  const findings: Finding[] = [...schema];
  const parseFindings: Finding[] = [];
  for (const unit of equationUnits(applied)) {
    try {
      parse(unit.text);
    } catch (err) {
      parseFindings.push({
        stage: "parse",
        severity: "error",
        element: unit.element,
        message: `${unit.element}.${unit.field}: ${(err as Error).message}`,
      });
    }
  }
  findings.push(...parseFindings);
  if (hasErrors(parseFindings)) return { ok: false, model: applied, findings };

  const structure = structuralFindings(applied);
  findings.push(...structure);
  if (hasErrors(structure)) return { ok: false, model: applied, findings };

  // Units are advisory: they never make a patch invalid, but the author should
  // see a dimensional mismatch alongside the other warnings.
  findings.push(
    ...checkUnits(applied).map((finding) => ({
      stage: "units" as const,
      severity: "warning" as const,
      element: finding.element,
      message: finding.message,
    })),
  );

  findings.push(...smokeFindings(applied));
  return { ok: !hasErrors(findings), model: applied, findings };
}
