export {
  parse,
  evaluate,
  evaluateExpression,
  collectReferences,
  ParseError,
} from "./expr.js";
export type { EvalContext, Expr, Reference, Site, BinaryOp } from "./expr.js";

export { canonicalName, computeOrder, orderPhases } from "./order.js";
export type { OrderPhases } from "./order.js";

export { simulate } from "./simulate.js";
export { ArrayError, elementName, expandArrays, hasArrays } from "./arrays.js";
export type { SimulationResult, SimulateOptions } from "./simulate.js";

export {
  BUILTINS,
  CLOCK_VARIABLES,
  CONSTANTS,
  evaluateBuiltin,
  lookupBuiltin,
} from "./builtins.js";
export type { Builtin, BuiltinEnv, BuiltinState, StateStore } from "./builtins.js";