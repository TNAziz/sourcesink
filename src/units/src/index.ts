/**
 * SourceSink — static units package.
 *
 * Parse a unit, infer the units of an equation from the elements it reads, and
 * check a whole model for dimensional inconsistencies. All findings are
 * warnings: units are documentary in the model IR and may be blank.
 */

export {
  formatUnit,
  isDimensionless,
  isUnitParseError,
  parseUnit,
  unitsEqual,
  type Unit,
  type UnitParseError,
} from "./unit.js";
export { inferUnits, type UnitEnv, type UnitIssue, type UnitResult } from "./infer.js";
export { checkUnits, type UnitFinding } from "./check.js";
