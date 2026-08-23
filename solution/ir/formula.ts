// A small, safe arithmetic evaluator for `formula` derived fields. No `eval`,
// no property access — only numbers, identifiers, `+ - * /`, parentheses, and
// unary sign over a fixed grammar:
//   expr   := term (('+'|'-') term)*
//   term   := factor (('*'|'/') factor)*
//   factor := number | ident | '(' expr ')' | ('-'|'+') factor
// Returns null on any parse error, unknown/blank identifier, or non-finite
// result (e.g. divide-by-zero), so a bad formula degrades to "no value".

type TokenType = "+" | "-" | "*" | "/" | "(" | ")" | "number" | "ident";
interface Token { type: TokenType; value?: number; name?: string }
type Resolver = (id: string) => number | null;

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const c = expression[i] as string;
    if (c === " " || c === "\t" || c === "\n") { i += 1; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "(" || c === ")") {
      tokens.push({ type: c });
      i += 1;
      continue;
    }
    if (/[0-9.]/u.test(c)) {
      let j = i + 1;
      while (j < expression.length && /[0-9.]/u.test(expression[j] as string)) j += 1;
      const value = Number(expression.slice(i, j));
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/u.test(c)) {
      let j = i + 1;
      while (j < expression.length && /[a-zA-Z0-9_]/u.test(expression[j] as string)) j += 1;
      tokens.push({ type: "ident", name: expression.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    return null; // illegal character
  }
  return tokens;
}

export function evaluateFormula(expression: string, resolve: Resolver): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  let failed = false;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => tokens[pos++] as Token;

  function parseExpr(): number {
    let value = parseTerm();
    while (!failed && (peek()?.type === "+" || peek()?.type === "-")) {
      const op = next().type;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (!failed && (peek()?.type === "*" || peek()?.type === "/")) {
      const op = next().type;
      const rhs = parseFactor();
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }
  function parseFactor(): number {
    const token = peek();
    if (!token) { failed = true; return 0; }
    if (token.type === "-") { next(); return -parseFactor(); }
    if (token.type === "+") { next(); return parseFactor(); }
    if (token.type === "number") { next(); return token.value ?? 0; }
    if (token.type === "ident") {
      next();
      const resolved = resolve(token.name ?? "");
      if (resolved === null || !Number.isFinite(resolved)) { failed = true; return 0; }
      return resolved;
    }
    if (token.type === "(") {
      next();
      const value = parseExpr();
      if (peek()?.type !== ")") { failed = true; return 0; }
      next();
      return value;
    }
    failed = true;
    return 0;
  }

  const result = parseExpr();
  if (failed || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

// Validate an expression and collect the identifiers it references. Returns null
// when the expression does not parse. Used at compile time to check that every
// referenced field exists and is numeric before keeping the formula.
export function analyzeFormula(expression: string): { ids: string[] } | null {
  const ids = new Set<string>();
  const evaluated = evaluateFormula(expression, (id) => { ids.add(id); return 1; });
  return evaluated === null ? null : { ids: [...ids] };
}
