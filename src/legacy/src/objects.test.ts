import { describe, it, expect } from "vitest";
import { readObjects } from "./objects.js";

const names = new Map([
  [2, "C_String"],
  [5, "int16_array"],
  [9, "Picture"],
]);
const read = (bytes: number[]) => readObjects(new Uint8Array(bytes), 0, names);

describe("readObjects — forms", () => {
  it("reads null, declared, reused and explicit-size payloads", () => {
    const objs = read([
      0xc0, 5, // null
      0xd9, 5, 4, 2, 0, 0x00, 0x07, // declare int16_array size 2
      0xc1, 5, 0x00, 0x09, // reuse size 2
      0xcc, 5, 4, 0, 1, 0, 2, // one-off size 4
    ]);
    expect(objs.map((o) => [o.form, o.type, [...o.data]])).toEqual([
      [0xc0, "int16_array", []],
      [0xd9, "int16_array", [0, 7]],
      [0xc1, "int16_array", [0, 9]],
      [0xcc, "int16_array", [0, 1, 0, 2]],
    ]);
  });

  it("one-off sizes (d3, d4, de) do not change the declared size", () => {
    const objs = read([
      0xd9, 5, 2, 2, 0, 0xaa, 0xbb,
      0xd3, 5, 9, 4, 1, 2, 3, 4,
      0xd4, 5, 0, 1, 7,
      0xde, 5, 0, 9, 0, 3, 1, 1, 1,
      0xc1, 5, 0xcc, 0xdd,
    ]);
    expect(objs.map((o) => o.data.length)).toEqual([2, 4, 1, 3, 2]);
  });

  it("wide declarations (e5, e8) set 16-bit record sizes", () => {
    const payload = new Array(300).fill(1);
    const objs = read([0xe5, 5, 1, 44, 1, 44, 0, ...payload, 0xe8, 5, 0, 2, 0, 2, 0, 0, 7, 7, 0xc1, 5, 8, 8]);
    expect(objs.map((o) => o.data.length)).toEqual([300, 2, 2]);
  });

  it("reads strings as NUL-terminated under c1, and back-references", () => {
    const objs = read([0xc1, 2, 0x41, 0x42, 0, 0xca, 2, 7, 0xd0, 2, 1, 2]);
    expect(objs.map((o) => [o.form, o.ref, o.data.length])).toEqual([
      [0xc1, undefined, 3],
      [0xca, 7, 0],
      [0xd0, 0x0102, 0],
    ]);
  });

  it("reads u8/u16-field forms with the declared payload", () => {
    const objs = read([0xd9, 5, 2, 2, 0, 0, 0, 0xcb, 5, 3, 1, 1, 0xc9, 5, 3, 2, 2, 0xd1, 5, 0, 1, 3, 3, 0xd2, 5, 0, 1, 4, 4]);
    expect(objs.map((o) => [...o.data])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it("reads large f4 blobs (u24 sizes plus a trailing byte)", () => {
    const objs = read([0xf4, 0, 9, 0, 0, 3, 0, 0, 3, 0, 0, 0, 1, 2, 3, 0xff, 0xc0, 2]);
    expect(objs.map((o) => [o.type, [...o.data]])).toEqual([
      ["Picture", [1, 2, 3]],
      ["C_String", []],
    ]);
  });

  it("reports unknown forms and undeclared sizes with the offset", () => {
    expect(() => read([0xc0, 5, 0x42, 5])).toThrow(/unknown object form 0x42 at offset 0x2/);
    expect(() => read([0xc1, 5, 0, 0])).toThrow(/used before declaration at offset 0x0/);
  });
});
