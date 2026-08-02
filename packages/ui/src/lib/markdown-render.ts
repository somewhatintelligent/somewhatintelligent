/**
 * Editor-preview-only markdown → HTML approximation. The canonical published
 * render is `workers/site/src/lib/markdown.ts` (RFC-0001 D9 / INV-PAGE-1); this
 * is a copy kept in the UI package so the editor's live preview can render
 * without a worker binding. Keep the two in sync when the render rules change.
 *
 * Raw HTML is inert BY CONSTRUCTION: markdown-it runs with `html: false`, so any
 * `<script>`, `<img onerror>`, or `<iframe>` in the source is escaped to text
 * rather than parsed. markdown-it's default `validateLink` rejects
 * `javascript:`/`vbscript:`/`file:`/non-image `data:` destinations, so a
 * `[x](javascript:…)` link renders as inert text. External links additionally
 * get `rel="noopener noreferrer"`. Unresolved `[[slug]]` / `[[slug|label]]`
 * wikilinks resolve to internal `/writing/:slug` links via a dedicated inline
 * rule registered before the standard link rule (so it never fires inside code
 * spans). Pure functions only — no DOM, no worker binding.
 */
import MarkdownIt from "markdown-it";

/**
 * Normalize a wikilink target to a URL-safe text slug (lowercase, non-alnum runs
 * collapsed to a single hyphen, edges trimmed). Returns `null` when nothing
 * usable remains, so the source `[[…]]` is left as literal text.
 */
export function slugifyWikilinkTarget(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

/** True for absolute (`http:`/`https:`) or protocol-relative (`//`) hrefs. */
function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith("//");
}

function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    // Match the opening `[[`.
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
    const end = src.indexOf("]]", start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    // Reject nested brackets — not a well-formed wikilink.
    if (inner.includes("[") || inner.includes("]")) return false;

    const pipe = inner.indexOf("|");
    const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const label = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
    const slug = slugifyWikilinkTarget(target);
    if (slug === null) return false;

    if (!silent) {
      const open = state.push("link_open", "a", 1);
      open.attrs = [["href", `/writing/${slug}`]];
      const text = state.push("text", "", 0);
      text.content = label.length > 0 ? label : slug;
      state.push("link_close", "a", -1);
    }
    state.pos = end + 2;
    return true;
  });
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
});
md.use(wikilinkPlugin);

// Tag external links so an opened tab cannot reach back through `window.opener`.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token?.attrGet("href") ?? "";
  if (token && isExternalHref(href)) {
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Render a body's raw markdown to render-safe HTML (editor preview only). */
export function renderMarkdown(body: string): string {
  return md.render(body ?? "");
}
