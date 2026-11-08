// A small expression language for `where` and `y`: fields, numbers, strings,
// arithmetic, comparisons, `and`/`or`/`not`, `in [..]`, and `this.<property>`
// for the note holding the chart. Parsed into a tree and evaluated: never eval.
//
//   analyte == "ferritin" and date >= "2026-01-01"
//   distance_km * 1000 / (hr_avg * duration_min)
//   sport in ["running", "walking"]
//   date == this.Date
//   `End Date` > "2026-01-01"            (backticks for names with spaces)

export type Scalar = number | string | boolean | null;
export type Fields = Record<string, unknown>;

type Node =
  | { kind: "literal"; value: Scalar }
  | { kind: "field"; name: string; self: boolean }
  | { kind: "list"; items: Node[] }
  | { kind: "unary"; op: "-" | "not"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };

type Token = { type: "num" | "str" | "name" | "op" | "end"; text: string; value?: Scalar; pos: number };

const KEYWORDS = new Set(["and", "or", "not", "in", "true", "false", "null"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = source.slice(i);
    const number = rest.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: "num", text: number[0], value: Number(number[0]), pos: i });
      i += number[0].length;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\" && j + 1 < source.length) j++;
        text += source[j++];
      }
      if (j >= source.length) throw new Error(`unclosed string at ${i + 1}`);
      tokens.push({ type: "str", text, value: text, pos: i });
      i = j + 1;
    } else if (c === "`") {
      const end = source.indexOf("`", i + 1);
      if (end < 0) throw new Error(`unclosed name at ${i + 1}`);
      tokens.push({ type: "name", text: source.slice(i + 1, end), pos: i });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const name = rest.match(/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*|\.`[^`]+`)*/)![0];
      tokens.push({ type: KEYWORDS.has(name) ? "op" : "name", text: name, pos: i });
      i += name.length;
    } else {
      const op = ["==", "!=", "<=", ">=", "&&", "||"].find((o) => rest.startsWith(o)) ?? c;
      if (!"+-*/%<>()[],!=&|".includes(op[0]) || op === "&" || op === "|") throw new Error(`unexpected "${c}" at ${i + 1}`);
      tokens.push({ type: "op", text: op === "&&" ? "and" : op === "||" ? "or" : op === "!" ? "not" : op === "=" ? "==" : op, pos: i });
      i += op.length;
    }
  }
  tokens.push({ type: "end", text: "", pos: source.length });
  return tokens;
}

const PRECEDENCE: Record<string, number> = { or: 1, and: 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, in: 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

function parse(source: string): Node {
  const tokens = tokenize(source);
  let k = 0;
  const peek = () => tokens[k];
  const next = () => tokens[k++];
  const expect = (text: string) => {
    const token = next();
    if (token.text !== text || token.type === "str") throw new Error(`expected "${text}" at ${token.pos + 1}`);
  };

  const primary = (): Node => {
    const token = next();
    if (token.type === "num" || token.type === "str") return { kind: "literal", value: token.value ?? null };
    if (token.type === "op" && token.text === "(") {
      const node = expression(0);
      expect(")");
      return node;
    }
    if (token.type === "op" && token.text === "[") {
      const items: Node[] = [];
      while (peek().text !== "]") {
        items.push(expression(0));
        if (peek().text === ",") next();
        else break;
      }
      expect("]");
      return { kind: "list", items };
    }
    if (token.type === "op" && (token.text === "-" || token.text === "not")) return { kind: "unary", op: token.text, arg: expression(token.text === "-" ? 7 : 2) };
    if (token.type === "op" && ["true", "false", "null"].includes(token.text)) return { kind: "literal", value: token.text === "null" ? null : token.text === "true" };
    if (token.type === "name") {
      const self = token.text.startsWith("this.");
      const name = (self ? token.text.slice(5) : token.text).replace(/^`|`$/g, "");
      return { kind: "field", name, self };
    }
    throw new Error(token.type === "end" ? "unexpected end" : `unexpected "${token.text}" at ${token.pos + 1}`);
  };

  const expression = (min: number): Node => {
    let left = primary();
    for (;;) {
      const token = peek();
      const precedence = token.type === "op" ? PRECEDENCE[token.text] : undefined;
      if (precedence === undefined || precedence <= min) return left;
      next();
      left = { kind: "binary", op: token.text, left, right: expression(precedence) };
    }
  };

  const node = expression(0);
  if (peek().type !== "end") throw new Error(`unexpected "${peek().text}" at ${peek().pos + 1}`);
  return node;
}

/** A value from a field: numbers, strings, booleans; a link "[[Note]]" or "[[Note|Alias]]" as the note's name. */
function scalar(value: unknown): Scalar | Scalar[] {
  if (Array.isArray(value)) return value.map((item) => scalar(item) as Scalar);
  if (typeof value === "string") {
    const link = value.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
    return link ? link[1] : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return value === undefined || value === null ? null : String(value);
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
};

function equal(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const [x, y] = [asNumber(a), asNumber(b)];
  if (x !== null && y !== null) return x === y;
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number | null {
  if (a === null || b === null) return null;
  const [x, y] = [asNumber(a), asNumber(b)];
  if (x !== null && y !== null) return x - y;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function evaluate(node: Node, row: Fields, self: Fields): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "field": {
      const source = node.self ? self : row;
      return scalar(node.name in source ? source[node.name] : undefined);
    }
    case "list":
      return node.items.map((item) => evaluate(item, row, self));
    case "unary": {
      const value = evaluate(node.arg, row, self);
      if (node.op === "not") return !truthy(value);
      const n = asNumber(value);
      return n === null ? null : -n;
    }
    case "binary": {
      if (node.op === "and") return truthy(evaluate(node.left, row, self)) && truthy(evaluate(node.right, row, self));
      if (node.op === "or") return truthy(evaluate(node.left, row, self)) || truthy(evaluate(node.right, row, self));
      const [a, b] = [evaluate(node.left, row, self), evaluate(node.right, row, self)];
      switch (node.op) {
        case "==":
          return Array.isArray(a) ? a.some((item) => equal(item, b)) : equal(a, b);
        case "!=":
          return Array.isArray(a) ? !a.some((item) => equal(item, b)) : !equal(a, b);
        case "in":
          return Array.isArray(b) ? b.some((item) => equal(a, item)) : typeof b === "string" && typeof a === "string" ? b.includes(a) : false;
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const order = compare(a, b);
          if (order === null) return false;
          return node.op === "<" ? order < 0 : node.op === "<=" ? order <= 0 : node.op === ">" ? order > 0 : order >= 0;
        }
        default: {
          const [x, y] = [asNumber(a), asNumber(b)];
          if (x === null || y === null) return node.op === "+" && typeof a === "string" ? `${a}${b ?? ""}` : null;
          if (node.op === "+") return x + y;
          if (node.op === "-") return x - y;
          if (node.op === "*") return x * y;
          if (node.op === "/") return y === 0 ? null : x / y;
          return y === 0 ? null : x % y;
        }
      }
    }
  }
}

const truthy = (value: unknown): boolean => value !== null && value !== undefined && value !== false && value !== 0 && value !== "";

export interface Compiled {
  /** The value of the expression for a row; `self` holds the note's properties for `this.`. */
  (row: Fields, self?: Fields): unknown;
  /** Fields of the rows it reads. */
  fields: string[];
}

/** Compiles an expression; throws with the position of the first error. */
export function compile(source: string): Compiled {
  let tree: Node;
  try {
    tree = parse(source);
  } catch (err) {
    throw new Error(`in "${source}": ${err instanceof Error ? err.message : err}`);
  }
  const fields = new Set<string>();
  const walk = (node: Node): void => {
    if (node.kind === "field" && !node.self) fields.add(node.name);
    if (node.kind === "list") node.items.forEach(walk);
    if (node.kind === "unary") walk(node.arg);
    if (node.kind === "binary") [node.left, node.right].forEach(walk);
  };
  walk(tree);
  const run = ((row: Fields, self: Fields = {}) => evaluate(tree, row, self)) as Compiled;
  run.fields = [...fields];
  return run;
}

/** True when the expression holds for the row. */
export function test(expression: Compiled, row: Fields, self: Fields = {}): boolean {
  return truthy(expression(row, self));
}

export { asNumber };
