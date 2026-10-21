import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyModel } from "@sourcesink/model";
import {
  AUTOSAVE_KEY,
  deserializeAutosave,
  readAutosave,
  serializeAutosave,
  writeAutosave,
} from "./autosave";

describe("autosave serialization", () => {
  it("round-trips a model, file name and timestamp", () => {
    const model = emptyModel("Round Trip");
    model.converters.push({ kind: "converter", id: "k", name: "k", equation: "1" });
    const raw = serializeAutosave(model, "round-trip.xmile", 1234);
    const record = deserializeAutosave(raw);
    expect(record).not.toBeNull();
    expect(record!.fileName).toBe("round-trip.xmile");
    expect(record!.savedAt).toBe(1234);
    expect(record!.model.name).toBe("Round Trip");
    expect(record!.model.converters).toHaveLength(1);
  });

  it("normalizes a missing file name to null", () => {
    const raw = serializeAutosave(emptyModel(), null);
    expect(deserializeAutosave(raw)!.fileName).toBeNull();
  });

  it("returns null for empty, malformed or non-model payloads", () => {
    expect(deserializeAutosave(null)).toBeNull();
    expect(deserializeAutosave("")).toBeNull();
    expect(deserializeAutosave("not json")).toBeNull();
    expect(deserializeAutosave("42")).toBeNull();
    expect(deserializeAutosave('{"fileName":"x"}')).toBeNull();
    expect(deserializeAutosave('{"model":{"stocks":[]}}')).toBeNull();
  });
});

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  return storage as unknown as Storage;
}

describe("autosave storage access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes and reads back through localStorage", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    writeAutosave(emptyModel("Persisted"), "persisted.xmile");
    const record = readAutosave();
    expect(record).not.toBeNull();
    expect(record!.fileName).toBe("persisted.xmile");
    expect(record!.model.name).toBe("Persisted");
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeTruthy();
    expect(AUTOSAVE_KEY).toBe("sourcesink:autosave:v1");
  });

  it("degrades gracefully when localStorage is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readAutosave()).toBeNull();
    expect(() => writeAutosave(emptyModel(), "x.xmile")).not.toThrow();
  });
});
