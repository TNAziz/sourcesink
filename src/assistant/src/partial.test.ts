import { describe, expect, it } from "vitest";

import { partialMessage } from "./partial.js";

describe("partialMessage", () => {
  it("returns the whole message of a complete object", () => {
    expect(partialMessage('{"message":"hello","questions":[]}')).toBe("hello");
  });

  it("returns the text so far before the closing quote", () => {
    expect(partialMessage('{"message":"hel')).toBe("hel");
  });

  it("returns an empty string once the value's quote has opened", () => {
    expect(partialMessage('{"message":"')).toBe("");
  });

  it("returns undefined before the message field starts", () => {
    expect(partialMessage("")).toBeUndefined();
    expect(partialMessage("{")).toBeUndefined();
    expect(partialMessage('{"message"')).toBeUndefined();
    expect(partialMessage('{"message":')).toBeUndefined();
  });

  it("returns undefined when there is no message field", () => {
    expect(partialMessage('{"messages":["hi"],"stage":"question"}')).toBeUndefined();
    expect(partialMessage('{"other":{"message":"nested"}}')).toBeUndefined();
  });

  it("decodes escapes, including a closing quote", () => {
    expect(partialMessage('{"message":"say \\"hi\\"\\nnow"}')).toBe('say "hi"\nnow');
    expect(partialMessage('{"message":"a\\\\b\\tc"}')).toBe("a\\b\tc");
    expect(partialMessage('{"message":"caf\\u00e9"}')).toBe("café");
    expect(partialMessage('{"message":"café"}')).toBe("café");
  });

  it("does not add an escape that is still split across deltas", () => {
    expect(partialMessage('{"message":"a\\')).toBe("a");
    expect(partialMessage('{"message":"a\\u00')).toBe("a");
  });

  it("tolerates a leading json fence", () => {
    expect(partialMessage('```json\n{"message":"hi","questions":[]}')).toBe("hi");
    expect(partialMessage('\n```\n{"message":"hi"')).toBe("hi");
    expect(partialMessage("```json\n")).toBeUndefined();
  });

  it("ignores a message key nested inside a patch", () => {
    expect(
      partialMessage('{"patch":{"ops":[]},"message":"after the patch"}'),
    ).toBe("after the patch");
    expect(partialMessage('{"patch":{"message":"inside"}')).toBeUndefined();
  });

  it("stops at the end of the root object", () => {
    expect(partialMessage('{"questions":[]}')).toBeUndefined();
  });
});
