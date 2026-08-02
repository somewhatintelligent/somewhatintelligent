/**
 * An unclassified error makes an agent retry everything until it hits the cap.
 * The kind is the whole point: `semantic` means fix and retry, `resolution`
 * means change approach, `internal` means stop and tell the human.
 */

export type DiagnosticKind = "semantic" | "resolution" | "internal";

export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: number;
}

/** TypeScript codes meaning "this module does not exist", not "this code is wrong". */
const RESOLUTION_TS_CODES = new Set([2307, 2792, 2688, 6053, 2691]);

const RESOLUTION_TEXT =
  /(could not resolve|cannot find module|module not found|failed to resolve|no matching version|version not found|404 not found|is not in this registry|enotfound|etarget|package .* does not exist)/i;

const INTERNAL_TEXT =
  /(internal error|unexpected token in bundler|panic|out of memory|worker exceeded|assertion failed)/i;

export const classify = (message: string, code?: number): DiagnosticKind => {
  if (code !== undefined && RESOLUTION_TS_CODES.has(code)) return "resolution";
  if (RESOLUTION_TEXT.test(message)) return "resolution";
  if (INTERNAL_TEXT.test(message)) return "internal";
  return "semantic";
};

export const diagnostic = (input: {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  code?: number;
  kind?: DiagnosticKind;
}): Diagnostic => ({
  kind: input.kind ?? classify(input.message, input.code),
  file: input.file ?? "<unknown>",
  line: input.line ?? 0,
  column: input.column ?? 0,
  message: input.message,
  ...(input.code === undefined ? {} : { code: input.code }),
});
