/**
 * OPERATOR PROSE, RENDERED AS MARKDOWN.
 *
 * The fields this handles are written in the operator console — a product
 * description, the `Product details` panel, the notes beside a sizing chart —
 * and they are written in Markdown. They used to be printed as literal
 * characters, so a description reading "the `friend` declaration" showed the
 * backticks to the shopper.
 *
 * WHY NOT ASTRO'S OWN PIPELINE, since it has one and this is an Astro site.
 * Astro 7 renders Markdown with `@astrojs/markdown-satteri`, whose engine
 * (`satteri`) is a native NAPI module with per-platform binaries. In workerd it
 * resolves its `browser` entry, which re-exports `@bruits/satteri-wasm32-wasi`
 * — a package declaring `cpu: ["wasm32"]`, which Bun refuses to install at all
 * ("Invalid CPU architecture: 'wasm32'"). So the first-class path is closed
 * here for a packaging reason, not a Workers one: Workers run WebAssembly
 * fine. If that package ever becomes installable, this file is the only thing
 * that has to change.
 *
 * `marked` is pure JavaScript with no dependencies, so it runs in the Worker
 * without a binary, a shim or a compatibility flag.
 */
import { Marked } from "marked";

/**
 * ONE INSTANCE PER ISOLATE, configured once. `gfm` for the tables and
 * strikethrough an operator would reasonably expect; `breaks` because these are
 * short prose fields typed into a textarea, where a single newline is meant as
 * a line break rather than as a continuation of the paragraph.
 */
const marked = new Marked({ gfm: true, breaks: true });

/**
 * Whether a field has anything in it, decided WITHOUT rendering.
 *
 * The page's absence branches — no details field, no accordion; no chart, no
 * `Size & fit` — are made in `product-view.ts`, which is a sync function tested
 * without a renderer. Emptiness is a question about the string, so it stays a
 * string operation and those tests stay honest.
 */
export const hasProse = (markdown: string | null | undefined): boolean =>
  (markdown ?? "").trim().length > 0;

/**
 * Rendered HTML, or `null` when there is nothing to render. `null` is what
 * tells a caller to emit NOTHING — no wrapper, no empty `<p>`, no panel.
 */
export const renderMarkdown = (markdown: string | null | undefined): string | null => {
  if (!hasProse(markdown)) return null;
  return marked.parse(markdown as string, { async: false });
};
