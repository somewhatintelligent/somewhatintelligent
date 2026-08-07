/**
 * THE SAFE MARKDOWN PATH, and it is deliberately not a Markdown renderer.
 *
 * Every string this handles is OPERATOR-AUTHORED and reaches a public page
 * unsanitised — a description, a details panel, a note beside a sizing chart.
 * The site has never had an HTML sanitiser and does not want one: a renderer
 * plus a sanitiser is two dependencies and a permanent obligation to keep an
 * allowlist correct, on a page whose prose needs paragraphs and nothing else.
 *
 * So this splits on blank lines and returns TEXT. Astro escapes text; nothing
 * downstream ever reaches `set:html`, which means there is no injection surface
 * to sanitise rather than a sanitiser to trust. Markdown syntax an operator
 * types survives as the literal characters they typed, which is honest — it
 * renders as what it is rather than silently becoming markup.
 *
 * The rule this file exists to make unbreakable: THREE fields now render
 * operator prose, not one. Copied into three components, the fourth caller
 * would have been the one that reached for `set:html`.
 */

/**
 * Paragraphs, or an empty list. An empty list is what tells a caller to render
 * NOTHING — no wrapper, no accordion, no placeholder — which is why whitespace
 * is trimmed before the emptiness is judged: a details field holding a single
 * newline is an absent panel, not a blank one.
 */
export const paragraphs = (markdown: string | null | undefined): string[] =>
  (markdown ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
