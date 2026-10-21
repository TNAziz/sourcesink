/**
 * SourceSink — connectors implied by equations.
 *
 * An equation that reads another element is an information link whether or
 * not the diagram draws it. Models written by hand or by a tool often carry
 * the equations without the connectors, which leaves the diagram with nothing
 * to anchor converters to. `missingConnectors` lists the links the equations
 * imply but the diagram lacks; `withInferredConnectors` adds them.
 *
 * Only flows and converters receive connectors: a stock changes through its
 * flows, so a name in a stock's initial value is not drawn as a link.
 */

import type { Connector, Model } from "@sourcesink/model";
import { canonicalName, collectReferences, parse } from "@sourcesink/engine";

/** A link an equation implies: `to`'s equation reads `from` (both names). */
export interface ImpliedLink {
  from: string;
  to: string;
}

/** Every equation text belonging to `name`: its own and any per-element
 * array equations. */
function equationsOf(model: Model, name: string, equation: string): string[] {
  const elements = model.arrayed?.[name]?.elements ?? {};
  return [equation, ...Object.values(elements)];
}

/** Links implied by flow and converter equations that no connector draws,
 * in model order. Unparseable equations contribute nothing. */
export function missingConnectors(model: Model): ImpliedLink[] {
  const byKey = new Map<string, string>();
  for (const e of [...model.stocks, ...model.flows, ...model.converters, ...model.graphFunctions]) {
    byKey.set(canonicalName(e.name), e.name);
  }
  const drawn = new Set(model.connectors.map((c) => `${canonicalName(c.from)}\u0000${canonicalName(c.to)}`));

  const out: ImpliedLink[] = [];
  for (const target of [...model.flows, ...model.converters]) {
    const toKey = canonicalName(target.name);
    for (const text of equationsOf(model, target.name, target.equation)) {
      let refs;
      try {
        refs = collectReferences(parse(text));
      } catch {
        continue;
      }
      for (const ref of refs) {
        const fromKey = canonicalName(ref.name);
        const from = byKey.get(fromKey);
        if (!from || fromKey === toKey) continue;
        const key = `${fromKey}\u0000${toKey}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        out.push({ from, to: target.name });
      }
    }
  }
  return out;
}

/** A copy of `model` with a connector for every link in `missingConnectors`.
 * Returns the model itself when nothing is missing. */
export function withInferredConnectors(model: Model): Model {
  const links = missingConnectors(model);
  if (links.length === 0) return model;
  const taken = new Set(model.connectors.map((c) => c.id));
  const added: Connector[] = links.map((l, i) => {
    let n = i + 1;
    while (taken.has(`connector-inferred-${n}`)) n += links.length;
    const id = `connector-inferred-${n}`;
    taken.add(id);
    return { kind: "connector", id, name: `${l.from} -> ${l.to}`, from: l.from, to: l.to };
  });
  return { ...model, connectors: [...model.connectors, ...added] };
}
