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
 * Astro's Markdown support is a BUILD-TIME content pipeline: it compiles `.md`
 * files and content-collection entries that the repository ships. These strings
 * are neither. They arrive from the database per request, written by an
 * operator long after the build, so there is nothing for that pipeline to have
 * compiled. Runtime prose needs a runtime renderer — this is a question of when
 * the text exists, not of what Workers can run.
 *
 * PROSE COMMITTED TO THE REPO — the writing pages — is the other case, and it
 * belongs in a content collection rendered by Astro. Do not reach for this
 * module there.
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

/**
 * The prose paragraphs of a field, AS MARKDOWN — not as HTML.
 *
 * The crawl surfaces are the callers: `/llms.txt` wants a one-paragraph summary
 * of an object, and the `.md` twins reproduce a page's prose in a markdown
 * document. Handing either of those `renderMarkdown`'s output would put `<p>`
 * tags inside a file whose whole promise is that it is markdown.
 *
 * THROUGH THE LEXER, not through a blank-line split. Splitting on `\n{2,}` is a
 * second, worse Markdown parser living beside the real one: it reads a fenced
 * code block containing a blank line as two paragraphs, and it reports a
 * heading or a list item as prose. `marked` already knows what a paragraph is,
 * and it is the only thing here allowed to decide.
 */
export const paragraphs = (markdown: string | null | undefined): string[] =>
  marked
    .lexer(markdown ?? "")
    .flatMap((token) => (token.type === "paragraph" ? [token.raw.trim()] : []))
    .filter((paragraph) => paragraph.length > 0);
