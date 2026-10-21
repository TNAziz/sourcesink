/**
 * SourceSink — equation parser + evaluator for the SD dialect.
 *
 * The parser is deliberately unaware of the model catalog: it only knows the
 * reserved keywords of the language (IF / THEN / ELSE / AND / OR / NOT). Any
 * `name(...)` is parsed as a generic function call whose meaning is decided by
 * the evaluator's `fn` callback — that is where built-ins (from the model
 * catalog) and graphical functions are dispatched.
 *
 * Identifiers may contain letters, digits, underscores and single spaces (SD
 * model names such as "savings account"). The tokenizer joins neighbouring
 * words separated by a single space into one identifier, stopping only before
 * a reserved word, so that `IF population growth THEN ...` still splits
 * correctly at THEN.
 */

/** A call-site key: stable across time steps so stateful functions can attach
 * per-call-site state. Parsed expressions number their call sites "0", "1", …
 * and the engine prefixes them with the owning element id. */
export type Site = string;

export interface EvalContext {
  /** Resolve a bare identifier (stock/flow/converter value, TIME, DT, …). */
  resolve(name: string): number;
  /** Evaluate a function call. `name` is the call's name as written; `args`
   * are already-evaluated numeric arguments; `site` is this call site's stable
   * key within the parsed expression. */
  fn(name: string, args: number[], site: Site): number;
  /** Optional: evaluate a call whose arguments name variables rather than
   * supply values (e.g. `CYCLETIME(flow)`). Return `undefined` to fall back
   * to `fn`. */
  byName?(name: string, args: Expr[], site: Site): number | undefined;
}

export type Expr =
  | { type: "number"; value: number }
  | { type: "ident"; name: string }
  | { type: "unary"; op: "neg" | "pos" | "not"; operand: Expr }
  | { type: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { type: "if"; cond: Expr; then: Expr; els: Expr }
  | { type: "call"; name: string; args: Expr[]; site: Site };

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "<"
  | "<="
  | ">"
  | ">="
  | "="
  | "=="
  | "<>"
  | "!="
  | "and"
  | "or";

export class ParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`parse error at position ${position}: ${message}`);
    this.name = "ParseError";
    this.position = position;
  }
}

const RESERVED = new Set(["IF", "THEN", "ELSE", "AND", "OR", "NOT"]);

interface Token {
  type: "number" | "word" | "op" | "eof";
  value: string;
  /** A `"double-quoted"` name: never a keyword, may hold any character. */
  quoted?: boolean;
  pos: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const NUMBER_RE = /\d+(\.\d*)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?/y;
const TWO_CHAR_OPS = new Set(["<=", ">=", "<>", "==", "!="]);
const SINGLE_CHAR_OPS = new Set(["<", ">", "=", "+", "-", "*", "/", "^", "(", ")", ","]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      i += 1;
      continue;
    }

    // XMILE-style quoted name, for names with characters such as $ % \ '
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new ParseError("unterminated quoted name", i);
      tokens.push({ type: "word", value: src.slice(i + 1, end), pos: i, quoted: true });
      i = end + 1;
      continue;
    }

    NUMBER_RE.lastIndex = i;
    const numMatch = NUMBER_RE.exec(src);
    if (numMatch) {
      tokens.push({ type: "number", value: numMatch[0], pos: i });
      i += numMatch[0].length;
      continue;
    }

    if (IDENT_START.test(c)) {
      const start = i;
      let j = i;
      while (j < n && IDENT_CHAR.test(src[j])) j += 1;
      let word = src.slice(i, j);

      // Munch "space + word" into the identifier unless the leading word or the
      // next word is a reserved keyword. This lets "birth rate" be one name
      // while "IF x THEN y" still splits into tokens.
      if (!RESERVED.has(word.toUpperCase())) {
        while (
          j < n &&
          src[j] === " " &&
          j + 1 < n &&
          IDENT_START.test(src[j + 1])
        ) {
          let k = j + 1;
          while (k < n && IDENT_CHAR.test(src[k])) k += 1;
          const nextWord = src.slice(j + 1, k);
          if (RESERVED.has(nextWord.toUpperCase())) break;
          word += " " + nextWord;
          j = k;
        }
      }

      i = j;
      tokens.push({ type: "word", value: word, pos: start });
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }

    if (SINGLE_CHAR_OPS.has(c)) {
      tokens.push({ type: "op", value: c, pos: i });
      i += 1;
      continue;
    }

    throw new ParseError(`unexpected character '${c}'`, i);
  }

  tokens.push({ type: "eof", value: "", pos: n });
  return tokens;
}

/** Parser: recursive descent over the token stream. */
class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private callCounter = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== "eof") this.pos += 1;
    return t;
  }

  private isOp(value: string): boolean {
    const t = this.tokens[this.pos];
    return t.type === "op" && t.value === value;
  }

  private isWord(value: string): boolean {
    const t = this.tokens[this.pos];
    return t.type === "word" && !t.quoted && t.value.toUpperCase() === value.toUpperCase();
  }

  private expectOp(value: string): void {
    const t = this.peek();
    if (t.type !== "op" || t.value !== value) {
      throw new ParseError(`expected '${value}' but found ${describe(t)}`, t.pos);
    }
    this.next();
  }

  private expectWord(value: string): void {
    const t = this.peek();
    if (t.type !== "word" || t.quoted || t.value.toUpperCase() !== value.toUpperCase()) {
      throw new ParseError(`expected '${value}' but found ${describe(t)}`, t.pos);
    }
    this.next();
  }

  private fail(message: string): never {
    throw new ParseError(message, this.peek().pos);
  }

  parseExpr(): Expr {
    const expr = this.parseOr();
    const t = this.peek();
    if (t.type !== "eof") {
      throw new ParseError(`unexpected trailing ${describe(t)}`, t.pos);
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isWord("OR")) {
      this.next();
      const right = this.parseAnd();
      left = { type: "binary", op: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isWord("AND")) {
      this.next();
      const right = this.parseNot();
      left = { type: "binary", op: "and", left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isWord("NOT")) {
      this.next();
      return { type: "unary", op: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const t = this.peek();
    if (
      t.type === "op" &&
      (t.value === "<" || t.value === "<=" || t.value === ">" ||
        t.value === ">=" || t.value === "=" || t.value === "<>" ||
        t.value === "==" || t.value === "!=")
    ) {
      this.next();
      const right = this.parseAdditive();
      return { type: "binary", op: t.value as BinaryOp, left, right };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const right = this.parseMultiplicative();
        left = { type: "binary", op: t.value as BinaryOp, left, right };
      } else {
        return left;
      }
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        const right = this.parseUnary();
        left = { type: "binary", op: t.value as BinaryOp, left, right };
      } else {
        return left;
      }
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === "op" && t.value === "-") {
      this.next();
      return { type: "unary", op: "neg", operand: this.parseUnary() };
    }
    if (t.type === "op" && t.value === "+") {
      this.next();
      return { type: "unary", op: "pos", operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePrimary();
    if (this.isOp("^")) {
      this.next();
      const exp = this.parseUnary();
      return { type: "binary", op: "^", left: base, right: exp };
    }
    return base;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.type === "number") {
      this.next();
      return { type: "number", value: Number(t.value) };
    }

    if (t.type === "op" && t.value === "(") {
      this.next();
      const inner = this.parseOr();
      this.expectOp(")");
      return inner;
    }

    if (t.type === "word") {
      const upper = t.quoted ? "" : t.value.toUpperCase();

      if (upper === "IF") {
        this.next();
        if (this.isOp("(")) {
          // IF(cond, a, b) — or `IF (cond) THEN a ELSE b`, so backtrack when
          // the parenthesised part turns out to be just the condition.
          const mark = this.pos;
          const calls = this.callCounter;
          try {
            this.next();
            const cond = this.parseOr();
            this.expectOp(",");
            const then = this.parseOr();
            this.expectOp(",");
            const els = this.parseOr();
            this.expectOp(")");
            return { type: "if", cond, then, els };
          } catch (err) {
            if (!(err instanceof ParseError)) throw err;
            this.pos = mark;
            this.callCounter = calls;
          }
        }
        const cond = this.parseOr();
        this.expectWord("THEN");
        const then = this.parseOr();
        this.expectWord("ELSE");
        const els = this.parseOr();
        return { type: "if", cond, then, els };
      }

      if (upper === "THEN" || upper === "ELSE" || upper === "AND" || upper === "OR" || upper === "NOT") {
        this.fail(`unexpected keyword '${t.value}'`);
      }

      // Function call (only if directly followed by "(").
      if (
        this.tokens[this.pos + 1] &&
        this.tokens[this.pos + 1].type === "op" &&
        this.tokens[this.pos + 1].value === "("
      ) {
        this.next(); // name
        this.next(); // "("
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseOr());
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        const site = String(this.callCounter++);
        return { type: "call", name: t.value, args, site };
      }

      this.next();
      return { type: "ident", name: t.value };
    }

    this.fail(`unexpected ${describe(t)}`);
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case "eof":
      return "end of expression";
    case "number":
      return `number '${t.value}'`;
    case "word":
      return `'${t.value}'`;
    case "op":
      return `'${t.value}'`;
  }
}

/** Parse an equation source string into an AST. Throws `ParseError` on invalid
 * input. Reuse the returned AST across time steps so call sites stay stable. */
export function parse(source: string): Expr {
  return new Parser(tokenize(source)).parseExpr();
}

export function evaluate(node: Expr, ctx: EvalContext): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "ident":
      return ctx.resolve(node.name);
    case "unary": {
      const v = evaluate(node.operand, ctx);
      if (node.op === "neg") return -v;
      if (node.op === "pos") return v;
      return v ? 0 : 1;
    }
    case "binary": {
      const op = node.op;
      if (op === "and") {
        return evaluate(node.left, ctx) ? (evaluate(node.right, ctx) ? 1 : 0) : 0;
      }
      if (op === "or") {
        return evaluate(node.left, ctx) ? 1 : evaluate(node.right, ctx) ? 1 : 0;
      }
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      switch (op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "^":
          return Math.pow(l, r);
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "=":
        case "==":
          return l === r ? 1 : 0;
        case "<>":
        case "!=":
          return l !== r ? 1 : 0;
      }
      return Number.NaN;
    }
    case "if":
      return evaluate(node.cond, ctx)
        ? evaluate(node.then, ctx)
        : evaluate(node.els, ctx);
    case "call": {
      const direct = ctx.byName?.(node.name, node.args, node.site);
      if (direct !== undefined) return direct;
      const args = node.args.map((a) => evaluate(a, ctx));
      return ctx.fn(node.name, args, node.site);
    }
  }
}

/** Parse and evaluate in one shot (parses afresh each call — stateful functions
 * will therefore reset between calls). For simulation use `parse` once and
 * `evaluate` repeatedly. */
export function evaluateExpression(source: string, ctx: EvalContext): number {
  return evaluate(parse(source), ctx);
}

/** A name reference discovered in an expression. */
export interface Reference {
  name: string;
  /** True when the reference is a `name(...)` call (e.g. a graphical function),
   * false for a bare identifier. */
  isFunction: boolean;
}

/** Collect every named reference in an AST (for dependency analysis). */
export function collectReferences(node: Expr): Reference[] {
  const out: Reference[] = [];
  const walk = (n: Expr): void => {
    switch (n.type) {
      case "number":
        return;
      case "ident":
        out.push({ name: n.name, isFunction: false });
        return;
      case "unary":
        walk(n.operand);
        return;
      case "binary":
        walk(n.left);
        walk(n.right);
        return;
      case "if":
        walk(n.cond);
        walk(n.then);
        walk(n.els);
        return;
      case "call":
        out.push({ name: n.name, isFunction: true });
        for (const a of n.args) walk(a);
        return;
    }
  };
  walk(node);
  return out;
}