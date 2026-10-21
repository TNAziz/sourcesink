/**
 * Apply a patch to a copy of a model.
 *
 * The applier is strict: an operation that cannot be applied (an unknown or
 * duplicate name, a bad kind, a field the target kind does not have) raises
 * `PatchError` carrying the operation's index. Nothing is mutated in place —
 * the caller's model is left untouched even when a later op fails.
 */

import type {
  Converter,
  Flow,
  GraphFunction,
  Model,
  Provenance,
  RunSpec,
  Stock,
} from "@sourcesink/model";

import {
  canonicalName,
  elementByName,
  nextConnectorId,
  nextElementId,
  normalizeNewName,
  patchableElements,
  replaceReference,
  resolveFlowRef,
  stockByName,
  type Patchable,
} from "./elements.js";
import { assertChangeFields, assertElementFields, assertRunFields } from "./schema.js";
import {
  PatchError,
  type ElementKind,
  type ModelPatch,
  type PatchOp,
} from "./types.js";

type Plain = Record<string, unknown>;

const ELEMENT_KINDS: readonly ElementKind[] = ["stock", "flow", "converter", "graphFunction"];

function isRecord(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stamp(element: object, provenance: Provenance | undefined): void {
  if (provenance) (element as { provenance?: Provenance }).provenance = structuredClone(provenance);
}

function hasName(m: Model, name: string, except?: Patchable): boolean {
  const key = canonicalName(name);
  return patchableElements(m).some((e) => e !== except && canonicalName(e.name) === key);
}

function requireElement(m: Model, name: unknown, index: number, op: PatchOp): Patchable {
  if (typeof name !== "string" || !name.trim()) {
    throw new PatchError(index, "name must be a non-empty string", op);
  }
  const element = elementByName(m, name);
  if (!element) throw new PatchError(index, `unknown element '${name}'`, op);
  return element;
}

function requireStock(m: Model, name: string, index: number, op: PatchOp, what: string): Stock {
  const stock = stockByName(m, name);
  if (!stock) throw new PatchError(index, `${what} '${name}' is not a known stock`, op);
  return stock;
}

function makeAddedElement(
  m: Model,
  kind: ElementKind,
  raw: Plain,
): { element: Patchable; list: Patchable[] } {
  const name = normalizeNewName(raw.name);
  if (hasName(m, name)) throw new Error(`duplicate element name '${name}'`);
  assertElementFields(kind, raw, "element");

  const element: Plain = {
    ...structuredClone(raw),
    name,
    kind,
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : nextElementId(m, kind, name),
  };
  if (patchableElements(m).some((e) => e.id === element.id)) {
    throw new Error(`duplicate element id '${String(element.id)}'`);
  }

  switch (kind) {
    case "stock":
      element.equation ??= "0";
      element.inflows ??= [];
      element.outflows ??= [];
      return { element: element as unknown as Stock, list: m.stocks };
    case "flow":
      element.equation ??= "0";
      return { element: element as unknown as Flow, list: m.flows };
    case "converter":
      element.equation ??= "0";
      return { element: element as unknown as Converter, list: m.converters };
    case "graphFunction":
      element.points ??= [];
      element.interpolation ??= "linear";
      element.extrapolation ??= "clip";
      return { element: element as unknown as GraphFunction, list: m.graphFunctions };
  }
}

function removeFromList(m: Model, element: Patchable): void {
  m.stocks = m.stocks.filter((e) => e !== element);
  m.flows = m.flows.filter((e) => e !== element);
  m.converters = m.converters.filter((e) => e !== element);
  m.graphFunctions = m.graphFunctions.filter((e) => e !== element);
}

function dropWiring(stock: Stock, flow: Flow): void {
  for (const side of ["inflows", "outflows"] as const) {
    const before = stock[side];
    if (before === undefined) continue;
    const after = before.filter((ref) => {
      if (ref === flow.id) return false;
      return canonicalName(ref) !== canonicalName(flow.name);
    });
    if (after.length !== before.length) stock[side] = after;
  }
}

function rewriteWiring(
  m: Model,
  oldName: string,
  newName: string,
  provenance: Provenance | undefined,
): void {
  const key = canonicalName(oldName);
  for (const stock of m.stocks) {
    for (const side of ["inflows", "outflows"] as const) {
      const before = stock[side] ?? [];
      const after = before.map((ref) => {
        if (ref === oldName) return newName;
        return canonicalName(ref) === key ? newName : ref;
      });
      if (after.some((ref, i) => ref !== before[i])) {
        stock[side] = after;
        stamp(stock, provenance);
      }
    }
  }
}

function applyOne(m: Model, op: PatchOp, index: number, provenance: Provenance | undefined): void {
  if (!isRecord(op)) throw new PatchError(index, "operation must be an object");

  switch (op.op) {
    case "add": {
      if (!ELEMENT_KINDS.includes(op.kind)) {
        throw new PatchError(index, `unknown element kind '${String(op.kind)}'`, op);
      }
      if (!isRecord(op.element)) throw new PatchError(index, "element must be an object", op);
      if (op.element.kind !== undefined && op.element.kind !== op.kind) {
        throw new PatchError(index, `element.kind must match the declared kind '${op.kind}'`, op);
      }
      try {
        const { element, list } = makeAddedElement(m, op.kind, op.element);
        stamp(element, provenance);
        list.push(element);
      } catch (err) {
        if (err instanceof PatchError) throw err;
        throw new PatchError(index, (err as Error).message, op);
      }
      return;
    }

    case "update": {
      const element = requireElement(m, op.name, index, op);
      if (!isRecord(op.changes)) throw new PatchError(index, "changes must be an object", op);
      if ("kind" in op.changes || "id" in op.changes || "name" in op.changes) {
        throw new PatchError(index, "changes may not set kind, id or name (use rename)", op);
      }
      try {
        assertChangeFields(element.kind, op.changes);
      } catch (err) {
        throw new PatchError(index, (err as Error).message, op);
      }
      Object.assign(element, structuredClone(op.changes));
      stamp(element, provenance);
      return;
    }

    case "rename": {
      const element = requireElement(m, op.name, index, op);
      let to: string;
      try {
        to = normalizeNewName(op.to, "to");
      } catch (err) {
        throw new PatchError(index, (err as Error).message, op);
      }
      if (hasName(m, to, element)) throw new PatchError(index, `duplicate element name '${to}'`, op);
      const old = element.name;
      if (old === to) return;

      element.name = to;
      const equationHolders: (Stock | Flow | Converter)[] = [...m.stocks, ...m.flows, ...m.converters];
      for (const holder of equationHolders) {
        const next = replaceReference(holder.equation, old, to);
        if (next !== holder.equation) {
          holder.equation = next;
          stamp(holder, provenance);
        }
      }
      for (const stock of m.stocks) {
        if (stock.conveyor) {
          const next = replaceReference(stock.conveyor.transitTime, old, to);
          if (next !== stock.conveyor.transitTime) {
            stock.conveyor.transitTime = next;
            stamp(stock, provenance);
          }
        }
        if (stock.oven) {
          const capacity = replaceReference(stock.oven.capacity, old, to);
          const fillTime = replaceReference(stock.oven.fillTime, old, to);
          if (capacity !== stock.oven.capacity || fillTime !== stock.oven.fillTime) {
            stock.oven.capacity = capacity;
            stock.oven.fillTime = fillTime;
            stamp(stock, provenance);
          }
        }
      }

      // Connectors refer by name; their display name follows.
      for (const c of m.connectors) {
        let changed = false;
        if (canonicalName(c.from) === canonicalName(old)) {
          c.from = to;
          changed = true;
        }
        if (canonicalName(c.to) === canonicalName(old)) {
          c.to = to;
          changed = true;
        }
        const display = `${c.from} -> ${c.to}`;
        if (c.name !== display) {
          c.name = display;
          changed = true;
        }
        if (changed) stamp(c, provenance);
      }

      // Stock wiring entries are normally ids, but names are accepted.
      rewriteWiring(m, old, to, provenance);

      if (m.layout?.[old]) {
        m.layout[to] = m.layout[old];
        delete m.layout[old];
      }
      if (old in m.arrayed) {
        m.arrayed[to] = m.arrayed[old];
        delete m.arrayed[old];
      }
      for (const scenario of m.scenarios ?? []) {
        const overrides: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(scenario.overrides)) {
          const nextKey = canonicalName(key) === canonicalName(old) ? to : key;
          overrides[nextKey] = typeof value === "string" ? replaceReference(value, old, to) : value;
        }
        scenario.overrides = overrides;
      }
      stamp(element, provenance);
      return;
    }

    case "remove": {
      const element = requireElement(m, op.name, index, op);
      const name = element.name;
      const key = canonicalName(name);
      removeFromList(m, element);
      m.connectors = m.connectors.filter(
        (c) => canonicalName(c.from) !== key && canonicalName(c.to) !== key,
      );
      if (element.kind === "flow") {
        for (const stock of m.stocks) dropWiring(stock, element);
      }
      if (m.layout) delete m.layout[name];
      delete m.arrayed[name];
      for (const scenario of m.scenarios ?? []) {
        for (const override of Object.keys(scenario.overrides)) {
          if (canonicalName(override) === key) delete scenario.overrides[override];
        }
      }
      return;
    }

    case "connect": {
      const from = requireElement(m, op.from, index, op);
      const to = requireElement(m, op.to, index, op);
      if (from === to) throw new PatchError(index, "an element cannot connect to itself", op);
      if (to.kind === "stock") {
        throw new PatchError(index, "connectors cannot point into a stock — use a flow", op);
      }
      const exists = m.connectors.some(
        (c) =>
          canonicalName(c.from) === canonicalName(from.name) &&
          canonicalName(c.to) === canonicalName(to.name),
      );
      if (exists) {
        throw new PatchError(index, `'${from.name}' is already connected to '${to.name}'`, op);
      }
      const connector = {
        kind: "connector" as const,
        id: nextConnectorId(m, from.id, to.id),
        name: `${from.name} -> ${to.name}`,
        from: from.name,
        to: to.name,
      };
      stamp(connector, provenance);
      m.connectors.push(connector);
      return;
    }

    case "disconnect": {
      const from = requireElement(m, op.from, index, op);
      const to = requireElement(m, op.to, index, op);
      const before = m.connectors.length;
      m.connectors = m.connectors.filter(
        (c) =>
          !(
            canonicalName(c.from) === canonicalName(from.name) &&
            canonicalName(c.to) === canonicalName(to.name)
          ),
      );
      if (m.connectors.length === before) {
        throw new PatchError(index, `no connector from '${from.name}' to '${to.name}'`, op);
      }
      return;
    }

    case "wire": {
      const flow = elementByName(m, String(op.flow));
      if (!flow || flow.kind !== "flow") {
        throw new PatchError(index, `unknown flow '${String(op.flow)}'`, op);
      }
      const fromGiven = "from" in op;
      const toGiven = "to" in op;

      const currentSource = () =>
        m.stocks.find((s) => (s.outflows ?? []).some((ref) => resolveFlowRef(m, ref) === flow));
      const currentSink = () =>
        m.stocks.find((s) => (s.inflows ?? []).some((ref) => resolveFlowRef(m, ref) === flow));

      const source =
        fromGiven
          ? op.from == null
            ? undefined
            : requireStock(m, op.from, index, op, "source stock")
          : currentSource();
      const sink =
        toGiven
          ? op.to == null
            ? undefined
            : requireStock(m, op.to, index, op, "sink stock")
          : currentSink();
      if (source && sink && source === sink) {
        throw new PatchError(index, "a flow cannot run from a stock back into itself", op);
      }

      for (const stock of m.stocks) dropWiring(stock, flow);
      if (source) {
        source.outflows = [...(source.outflows ?? []), flow.id];
        stamp(source, provenance);
      }
      if (sink) {
        sink.inflows = [...(sink.inflows ?? []), flow.id];
        stamp(sink, provenance);
      }
      stamp(flow, provenance);
      return;
    }

    case "setRun": {
      try {
        assertRunFields(op.run);
      } catch (err) {
        throw new PatchError(index, (err as Error).message, op);
      }
      const next: Partial<RunSpec> = { ...(op.run as Partial<RunSpec>) };
      m.run = { ...m.run, ...next };
      return;
    }

    case "setLayout": {
      const element = requireElement(m, op.name, index, op);
      if (typeof op.x !== "number" || !Number.isFinite(op.x) || typeof op.y !== "number" || !Number.isFinite(op.y)) {
        throw new PatchError(index, "x and y must be finite numbers", op);
      }
      m.layout = { ...(m.layout ?? {}), [element.name]: { x: op.x, y: op.y } };
      return;
    }

    default: {
      const unknown: never = op;
      throw new PatchError(index, `unknown op '${String((unknown as { op?: unknown }).op)}'`, unknown as PatchOp);
    }
  }
}

/** Apply every operation in order to a deep copy of `model`. Throws
 * `PatchError` with the failing operation's index. */
export function applyPatch(model: Model, patch: ModelPatch): Model {
  if (!isRecord(patch) || !Array.isArray(patch.ops)) {
    throw new PatchError(-1, "patch.ops must be an array");
  }
  const m = structuredClone(model);
  patch.ops.forEach((op, index) => applyOne(m, op, index, patch.provenance));
  return m;
}
