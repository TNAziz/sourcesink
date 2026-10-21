/**
 * Test helper: assemble a tiny synthetic `.stm` file from scratch, using the
 * layout in docs/format/stm.md. Lets the tokenizer and importer be tested
 * without the proprietary sample models.
 */

/** Class names in directory order; ids are 1-based positions. */
export const CLASSES = [
  "Book",
  "C_String",
  "Run_Specs",
  "entity_struct",
  "int16_array",
  "double_array",
  "token_type_array",
  "run_handle_array",
  "diagram_struct",
] as const;

export type ClassName = (typeof CLASSES)[number];
export const id = (c: ClassName): number => CLASSES.indexOf(c) + 1;

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export function header(app = "STL2", model = "STM2"): number[] {
  const h = new Array(0x80).fill(0);
  h.splice(0, 12, 6, 0, 6, 0, 0x80, 0, 0, 0x80, 0xfa, 0xd5, 0xfa, 0xde);
  h.splice(12, 8, ...ascii(app), ...ascii(model));
  h[0x14] = 1;
  return h;
}

export function directory(): number[] {
  const out: number[] = [];
  CLASSES.forEach((name, i) => out.push(...ascii(name), 0, 0, i + 1, 1, 0));
  return out;
}

export const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
export const be64 = (x: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x, false);
  return [...b];
};

/** Object encoders, one per form. */
export const obj = {
  nul: (c: ClassName) => [0xc0, id(c)],
  /** Declare the class's record size and emit one payload (u8 sizes via
   * `d9`, larger ones via the 16-bit `e5` form, as real files do). */
  declare: (c: ClassName, data: number[]) =>
    data.length < 256
      ? [0xd9, id(c), data.length, data.length, 0, ...data]
      : [0xe5, id(c), ...be16(data.length), ...be16(data.length), 0, ...data],
  /** Reuse the declared size. */
  reuse: (c: ClassName, data: number[]) => [0xc1, id(c), ...data],
  /** One-off u8-sized payload. */
  sized: (c: ClassName, data: number[]) => [0xcc, id(c), data.length, ...data],
  str: (s: string) => [0xcc, id("C_String"), s.length + 1, ...ascii(s), 0],
  int16s: (xs: number[]) => (xs.length ? obj.sized("int16_array", xs.flatMap(be16)) : obj.nul("int16_array")),
  doubles: (xs: number[]) => (xs.length ? obj.sized("double_array", xs.flatMap(be64)) : obj.nul("double_array")),
};

export interface EntitySpec {
  kind: "s" | "f" | "b" | "c" | "l" | "q" | "m" | "k" | "u" | "z" | "y";
  name: string;
  equation: string;
  inputs?: number[];
  inflows?: number[];
  outflows?: number[];
  /** Graph points: count + x range in the struct, ys as a double array. */
  graph?: { xmin: number; xmax: number; ys: number[] };
  nonNegative?: boolean;
  documentation?: string;
  /** Ovens: capacity and fill time (0 = the "DT" option). */
  oven?: { capacity: number; fillTime: number };
}

/** A 306-byte entity_struct payload. */
export function entityStruct(e: EntitySpec): number[] {
  const d = new Array(306).fill(0);
  d[0] = e.kind.charCodeAt(0);
  if (e.graph) {
    d.splice(14, 2, ...be16(e.graph.ys.length));
    d.splice(16, 8, ...be64(e.graph.xmin));
    d.splice(24, 8, ...be64(e.graph.xmax));
  }
  if (e.kind === "s") d[283] = e.nonNegative ? 3 : 2;
  // dialog settings shared by every variable (defaults: capacity 1, fill INF)
  d.splice(160, 8, ...be64(e.oven?.capacity ?? 1));
  d.splice(176, 8, ...be64(e.oven?.fillTime ?? Number.POSITIVE_INFINITY));
  return d;
}

export function entity(e: EntitySpec, first: boolean): number[] {
  const s = entityStruct(e);
  return [
    ...(first ? obj.declare("entity_struct", s) : obj.reuse("entity_struct", s)),
    ...obj.str(e.name),
    ...obj.str(e.equation),
    ...obj.int16s(e.inputs ?? []),
    ...obj.int16s([]),
    ...obj.int16s(e.inflows ?? []),
    ...obj.int16s(e.outflows ?? []),
    ...obj.doubles([]),
    ...obj.doubles(e.graph?.ys ?? []),
    ...obj.nul("token_type_array"),
    ...obj.nul("run_handle_array"),
    ...(e.documentation ? obj.str(e.documentation) : obj.nul("C_String")),
  ];
}

export function runSpecs(start: number, stop: number, dt: number, units: string): number[] {
  const d = new Array(106).fill(0);
  d.splice(0, 8, ...be64(start));
  d.splice(8, 8, ...be64(stop));
  d.splice(16, 8, ...be64(dt));
  d.splice(64, units.length, ...ascii(units));
  return obj.declare("Run_Specs", d);
}

/** A diagram glyph at (x, y) drawing entity #index. */
export function glyph(kind: string, x: number, y: number, index: number, first: boolean): number[] {
  const d = new Array(97).fill(0);
  d[0] = kind.charCodeAt(0);
  d.splice(1, 2, ...be16(y));
  d.splice(3, 2, ...be16(x));
  d.splice(17, 2, ...be16(index));
  return first ? obj.declare("diagram_struct", d) : obj.reuse("diagram_struct", d);
}

export function stmFile(body: number[]): Uint8Array {
  return new Uint8Array([...header(), ...directory(), ...body]);
}
