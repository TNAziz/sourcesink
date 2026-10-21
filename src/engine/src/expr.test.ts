import { describe, expect, it } from "vitest";

import {
  collectReferences,
  evaluate,
  evaluateExpression,
  ParseError,
  parse,
  type EvalContext,
} from "./expr.js";

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    resolve: (name) => {
      throw new Error(`unresolved '${name}'`);
    },
    fn: (name, args) => {
      switch (name.toUpperCase()) {
        case "ABS":
          return Math.abs(args[0]);
        case "MIN":
          return Math.min(...args);
        case "MAX":
          return Math.max(...args);
        default:
          throw new Error(`unknown fn '${name}'`);
      }
    },
    ...overrides,
  };
}

describe("arithmetic", () => {
  it("honors precedence and associativity", () => {
    expect(evaluateExpression("2 + 3 * 4", ctx())).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4", ctx())).toBe(20);
    expect(evaluateExpression("10 - 2 - 3", ctx())).toBe(5);
    expect(evaluateExpression("20 / 2 / 5", ctx())).toBe(2);
    expect(evaluateExpression("2 + 3 * 4 ^ 2", ctx())).toBe(50);
  });

  it("supports exponent (right associative)", () => {
    expect(evaluateExpression("2 ^ 3 ^ 2", ctx())).toBe(512);
    expect(evaluateExpression("2 ^ 3", ctx())).toBe(8);
  });

  it("handles unary minus", () => {
    expect(evaluateExpression("-5 + 3", ctx())).toBe(-2);
    expect(evaluateExpression("-2 ^ 2", ctx())).toBe(-4);
    expect(evaluateExpression("-(2 + 3)", ctx())).toBe(-5);
    expect(evaluateExpression("+7", ctx())).toBe(7);
  });
});

describe("IF", () => {
  it("evaluates IF(cond, then, else)", () => {
    expect(evaluateExpression("IF(1 > 0, 10, 20)", ctx())).toBe(10);
    expect(evaluateExpression("IF(1 < 0, 10, 20)", ctx())).toBe(20);
  });

  it("evaluates IF cond THEN a ELSE b", () => {
    expect(evaluateExpression("IF 2 > 1 THEN 7 ELSE 8", ctx())).toBe(7);
    expect(evaluateExpression("IF 2 < 1 THEN 7 ELSE 8", ctx())).toBe(8);
  });

  it("does not evaluate the unused branch (lazy)", () => {
    expect(evaluateExpression("IF(1, 5, 1 / 0)", ctx())).toBe(5);
  });
});

describe("functions", () => {
  it("MIN/MAX over 2+ args", () => {
    expect(evaluateExpression("MIN(3, 1, 2)", ctx())).toBe(1);
    expect(evaluateExpression("MAX(3, 1, 2)", ctx())).toBe(3);
    expect(evaluateExpression("MIN(4, 5)", ctx())).toBe(4);
  });
});

describe("comparison and logic", () => {
  it("comparison operators produce 0/1", () => {
    expect(evaluateExpression("3 < 5", ctx())).toBe(1);
    expect(evaluateExpression("3 > 5", ctx())).toBe(0);
    expect(evaluateExpression("3 <= 3", ctx())).toBe(1);
    expect(evaluateExpression("3 >= 4", ctx())).toBe(0);
    expect(evaluateExpression("3 = 3", ctx())).toBe(1);
    expect(evaluateExpression("3 <> 4", ctx())).toBe(1);
    expect(evaluateExpression("3 == 4", ctx())).toBe(0);
    expect(evaluateExpression("3 != 4", ctx())).toBe(1);
  });

  it("AND / OR / NOT", () => {
    expect(evaluateExpression("1 AND 1", ctx())).toBe(1);
    expect(evaluateExpression("1 AND 0", ctx())).toBe(0);
    expect(evaluateExpression("0 OR 1", ctx())).toBe(1);
    expect(evaluateExpression("0 OR 0", ctx())).toBe(0);
    expect(evaluateExpression("NOT 0", ctx())).toBe(1);
    expect(evaluateExpression("NOT 1", ctx())).toBe(0);
    expect(evaluateExpression("1 > 0 AND 2 > 1", ctx())).toBe(1);
  });
});

describe("identifiers", () => {
  it("resolves multi-word identifiers via the resolve callback", () => {
    const c = ctx({
      resolve: (name) => (name === "savings account" ? 100 : Number.NaN),
    });
    expect(evaluateExpression("savings account * 2", c)).toBe(200);
  });

  it("splits identifiers at reserved words", () => {
    const c = ctx({
      resolve: (name) => {
        if (name === "population growth") return 3;
        if (name === "growth context") return 4;
        throw new Error(name);
      },
    });
    expect(evaluateExpression("IF population growth THEN growth context ELSE 0", c)).toBe(4);
    expect(evaluateExpression("population growth AND growth context", c)).toBe(1);
  });
});

describe("parse errors", () => {
  it("throws ParseError with a position", () => {
    expect(() => parse("2 + * 3")).toThrow(ParseError);
    expect(() => parse("2 + * 3")).toThrow(/position 4/);
    const err = (() => {
      try {
        parse("2 + * 3");
      } catch (e) {
        return e as ParseError;
      }
    })()!;
    expect(err.position).toBe(4);
  });

  it("reports unexpected trailing input", () => {
    expect(() => parse("2 3")).toThrow(/trailing/);
    expect(() => parse("")).toThrow(/end of expression/);
  });

  it("reports unbalanced parentheses", () => {
    expect(() => parse("(1 + 2")).toThrow(/\)/);
    expect(() => parse("IF(1, 2, 3")).toThrow(/\)/);
  });

  it("reports incomplete IF without THEN", () => {
    expect(() => parse("IF 1 2")).toThrow(/THEN/);
  });
});
describe("quoted names", () => {
  it("reads a double-quoted name with any characters as one identifier", () => {
    const resolve = (name: string) => ({ "$_per_pro": 3, "hiring\\layoff_delay": 2, "Hooke's_constant": 5 })[name]!;
    expect(evaluateExpression('"$_per_pro" * 2', ctx({ resolve }))).toBe(6);
    expect(evaluateExpression('10 / "hiring\\layoff_delay"', ctx({ resolve }))).toBe(5);
    expect(evaluateExpression(`"Hooke's_constant" + 1`, ctx({ resolve }))).toBe(6);
  });

  it("never treats a quoted name as a keyword", () => {
    const resolve = (name: string) => (name === "IF" ? 4 : 0);
    expect(evaluateExpression('"IF" + 1', ctx({ resolve }))).toBe(5);
  });

  it("reports an unterminated quoted name", () => {
    expect(() => parse('"abc + 1')).toThrow(/unterminated quoted name/);
  });
});

describe("IF with a parenthesised condition", () => {
  it("parses `if (cond) then a else b` as well as IF(cond, a, b)", () => {
    expect(evaluateExpression("if (2 > 1 AND 3 > 2) then 10 else 20", ctx())).toBe(10);
    expect(evaluateExpression("IF (1 > 2) THEN 10 ELSE 20", ctx())).toBe(20);
    expect(evaluateExpression("IF(1 > 2, 10, 20)", ctx())).toBe(20);
  });
});

describe("array subscripts", () => {
  it("parse labels, dimension names and wildcards as references", () => {
    expect(collectReferences(parse("beta[4] * Area[Firm] + SUM(x[*, North])"))).toEqual([
      { name: "beta", isFunction: false },
      { name: "Area", isFunction: false },
      { name: "SUM", isFunction: true },
      { name: "x", isFunction: false },
    ]);
    expect(parse("pop[North, Old]")).toEqual({ type: "ident", name: "pop", subscript: ["North", "Old"] });
  });

  it("resolve a single element by its element name", () => {
    const c = ctx({ resolve: (n) => (n === "pop[North]" ? 7 : NaN) });
    expect(evaluate(parse("pop[North] * 2"), c)).toBe(14);
  });

  it("reject unfinished or empty subscripts", () => {
    expect(() => parse("pop[North")).toThrow(ParseError);
    expect(() => parse("pop[]")).toThrow(ParseError);
  });
});
