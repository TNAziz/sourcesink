import {
  emptyModel,
  type Converter,
  type Flow,
  type Model,
  type Stock,
} from "@sourcesink/model";

function stock(name: string, equation: string, inflows: string[] = [], outflows: string[] = []): Stock {
  return { kind: "stock", id: name, name, equation, inflows, outflows };
}

function flow(name: string, equation: string): Flow {
  return { kind: "flow", id: name, name, equation };
}

function converter(name: string, equation: string): Converter {
  return { kind: "converter", id: name, name, equation };
}

/** Logistic growth with an explicit crowding converter, so the crowding path is
 * a separate causal chain from the direct births path. */
export function logisticModel(): Model {
  const m = emptyModel("Logistic growth");
  m.run = { ...m.run, start: 0, stop: 50, dt: 0.25, saveEvery: 1, timeUnits: "Year" };
  m.stocks = [stock("Population", "100", ["births"])];
  m.flows = [flow("births", "r * Population * crowding")];
  m.converters = [
    converter("r", "0.3"),
    converter("carrying_capacity", "1000"),
    converter("crowding", "1 - Population / carrying_capacity"),
  ];
  return m;
}

export function decayModel(): Model {
  const m = emptyModel("Simple decay");
  m.stocks = [stock("S", "100", [], ["drain"])];
  m.flows = [flow("drain", "S * k")];
  m.converters = [converter("k", "0.1")];
  return m;
}

export function predatorPreyModel(): Model {
  const m = emptyModel("Predator-prey");
  m.run = { ...m.run, start: 0, stop: 30, dt: 0.1, saveEvery: 1, timeUnits: "Year" };
  m.stocks = [
    stock("prey", "10", ["prey_birth"], ["prey_death"]),
    stock("predator", "5", ["pred_birth"], ["pred_death"]),
  ];
  m.flows = [
    flow("prey_birth", "a * prey"),
    flow("prey_death", "b * prey * predator"),
    flow("pred_birth", "c * prey * predator"),
    flow("pred_death", "d * predator"),
  ];
  m.converters = [
    converter("a", "1.1"),
    converter("b", "0.4"),
    converter("c", "0.1"),
    converter("d", "0.4"),
  ];
  return m;
}

/** The inflow is deliberately insensitive to the stock at every time. */
export function zeroEffectModel(): Model {
  const m = emptyModel("Zero effect");
  m.stocks = [stock("S", "10", ["inflow"])];
  m.flows = [flow("inflow", "0 * S + 1")];
  return m;
}

/** `out` reads a graph function used as a variable, so its dependency is the
 * converter feeding the graph function's input connector. */
export function graphFunctionModel(): Model {
  const m = emptyModel("Graph function");
  m.converters = [converter("driver", "1"), converter("out", "curve")];
  m.graphFunctions = [
    {
      kind: "graphFunction",
      id: "curve",
      name: "curve",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ],
      interpolation: "linear",
      extrapolation: "clip",
    },
  ];
  m.connectors = [
    { kind: "connector", id: "driver->curve", name: "driver -> curve", from: "driver", to: "curve" },
  ];
  return m;
}
