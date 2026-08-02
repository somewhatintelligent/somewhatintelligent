/**
 * A tokeniser, not a parser. Six languages occur in a mezes — ts, tsx, js, jsx,
 * css, html, json — and the code view is read only, so a wrong colour costs
 * nothing while a highlighter dependency would cost the whole shell bundle.
 *
 * Every alternative inside a string rule is anchored on a distinct first
 * character, so the star cannot backtrack exponentially over an unclosed quote.
 */

type TokenKind = "comment" | "string" | "number" | "keyword" | "tag" | "attr" | "plain";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

interface Rule {
  readonly kind: TokenKind;
  /** One capturing group is wrapped around each rule, so patterns use `(?:…)`. */
  readonly pattern: string;
}

const KEYWORDS = [
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "namespace",
  "new",
  "null",
  "of",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "yield",
].join("|");

const TEMPLATE = "`(?:[^`\\\\]|\\\\[\\s\\S])*`";

const SCRIPT: readonly Rule[] = [
  { kind: "comment", pattern: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
  { kind: "string", pattern: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|${TEMPLATE}` },
  { kind: "tag", pattern: String.raw`<\/?[A-Za-z][\w.:-]*` },
  { kind: "keyword", pattern: String.raw`\b(?:${KEYWORDS})\b` },
  { kind: "tag", pattern: String.raw`\b[A-Z][A-Za-z0-9_]*\b` },
  { kind: "number", pattern: String.raw`\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
];

const CSS: readonly Rule[] = [
  { kind: "comment", pattern: String.raw`\/\*[\s\S]*?\*\/` },
  { kind: "string", pattern: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'` },
  { kind: "keyword", pattern: String.raw`@[\w-]+` },
  { kind: "number", pattern: String.raw`#[0-9a-fA-F]{3,8}\b` },
  { kind: "tag", pattern: String.raw`\.[-\w]+` },
  { kind: "attr", pattern: String.raw`--?[a-zA-Z][-\w]*(?=\s*:)|\b[a-z][-a-z]*(?=\s*:)` },
  {
    kind: "number",
    pattern: String.raw`\b-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex|pt)?\b`,
  },
];

const HTML: readonly Rule[] = [
  { kind: "comment", pattern: String.raw`<!--[\s\S]*?-->` },
  { kind: "keyword", pattern: String.raw`<![a-zA-Z][^>]*>` },
  { kind: "tag", pattern: String.raw`<\/?[a-zA-Z][\w:-]*` },
  { kind: "string", pattern: String.raw`"[^"]*"|'[^']*'` },
  { kind: "attr", pattern: String.raw`[a-zA-Z_:@][-\w:.]*(?=\s*=)` },
];

const JSON_RULES: readonly Rule[] = [
  { kind: "attr", pattern: String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)` },
  { kind: "string", pattern: String.raw`"(?:[^"\\]|\\.)*"` },
  { kind: "keyword", pattern: String.raw`\b(?:true|false|null)\b` },
  { kind: "number", pattern: String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
];

const RULES_BY_EXTENSION: Readonly<Record<string, readonly Rule[]>> = {
  ts: SCRIPT,
  tsx: SCRIPT,
  mts: SCRIPT,
  cts: SCRIPT,
  js: SCRIPT,
  jsx: SCRIPT,
  mjs: SCRIPT,
  cjs: SCRIPT,
  css: CSS,
  html: HTML,
  htm: HTML,
  svg: HTML,
  json: JSON_RULES,
};

/** Compiled once per language: the same file is re-tokenised on every render. */
const compiled = new WeakMap<readonly Rule[], RegExp>();

const patternFor = (rules: readonly Rule[]): RegExp => {
  const existing = compiled.get(rules);
  if (existing !== undefined) return existing;
  const built = new RegExp(rules.map((rule) => `(${rule.pattern})`).join("|"), "g");
  compiled.set(rules, built);
  return built;
};

/** `<div` is a bracket then a name, and only the name carries the tag colour. */
const emit = (tokens: Token[], kind: TokenKind, text: string): void => {
  if (text === "") return;
  if (kind === "tag" && text.startsWith("<")) {
    const lead = text.startsWith("</") ? 2 : 1;
    tokens.push({ kind: "plain", text: text.slice(0, lead) });
    tokens.push({ kind: "tag", text: text.slice(lead) });
    return;
  }
  tokens.push({ kind, text });
};

const ruleOf = (rules: readonly Rule[], match: RegExpExecArray): TokenKind => {
  for (let index = 1; index < match.length; index += 1) {
    if (match[index] !== undefined) return rules[index - 1]?.kind ?? "plain";
  }
  return "plain";
};

export const tokenise = (source: string, path: string): readonly Token[] => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const rules = RULES_BY_EXTENSION[extension];
  if (rules === undefined) return [{ kind: "plain", text: source }];

  const pattern = patternFor(rules);
  pattern.lastIndex = 0;

  const tokens: Token[] = [];
  let consumed = 0;
  for (;;) {
    const match = pattern.exec(source);
    if (match === null) break;
    // A zero-width match would never advance `lastIndex` on its own.
    if (match[0] === "") {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > consumed) emit(tokens, "plain", source.slice(consumed, match.index));
    emit(tokens, ruleOf(rules, match), match[0]);
    consumed = match.index + match[0].length;
  }
  if (consumed < source.length) emit(tokens, "plain", source.slice(consumed));
  return tokens;
};
