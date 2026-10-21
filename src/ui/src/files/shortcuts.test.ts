import { describe, expect, it } from "vitest";
import { shortcutFor, type KeyLike } from "./shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ...mods });

describe("shortcutFor — document commands", () => {
  it("maps Ctrl/Cmd+S and Ctrl/Cmd+Shift+S", () => {
    expect(shortcutFor(key("s", { ctrlKey: true }))).toBe("save");
    expect(shortcutFor(key("s", { metaKey: true }))).toBe("save");
    expect(shortcutFor(key("s", { ctrlKey: true, shiftKey: true }))).toBe("save-as");
    expect(shortcutFor(key("S", { metaKey: true, shiftKey: true }))).toBe("save-as");
  });

  it("maps open, undo, redo and run", () => {
    expect(shortcutFor(key("o", { ctrlKey: true }))).toBe("open");
    expect(shortcutFor(key("z", { ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(key("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(key("y", { ctrlKey: true }))).toBe("redo");
    expect(shortcutFor(key("Enter", { metaKey: true }))).toBe("run");
  });

  it("ignores modified keys it does not own", () => {
    expect(shortcutFor(key("p", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("s", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("shortcutFor — tools and escape", () => {
  it("maps the unmodified tool keys", () => {
    expect(shortcutFor(key("v"))).toBe("tool:select");
    expect(shortcutFor(key("s"))).toBe("tool:stock");
    expect(shortcutFor(key("f"))).toBe("tool:flow");
    expect(shortcutFor(key("c"))).toBe("tool:converter");
    expect(shortcutFor(key("k"))).toBe("tool:connector");
  });

  it("maps Escape to the escape action", () => {
    expect(shortcutFor(key("Escape"))).toBe("escape");
  });

  it("requires no modifiers for plain tool keys", () => {
    expect(shortcutFor(key("v", { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key("v", { altKey: true }))).toBeNull();
    expect(shortcutFor(key("v", { ctrlKey: true }))).toBeNull();
  });

  it("returns null for unbound keys", () => {
    expect(shortcutFor(key("q"))).toBeNull();
    expect(shortcutFor(key("1"))).toBeNull();
  });
});
