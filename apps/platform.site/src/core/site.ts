/**
 * THE SITE'S OWN ADDRESS, and every absolute URL derived from it.
 *
 * Absolute URLs are not a style preference here — three consumers refuse
 * relative ones outright: `<link rel="canonical">`, `og:image` (Facebook, X and
 * Slack all drop a relative value rather than resolving it), and every `<loc>`
 * in a sitemap. So the origin has to be a fact this module can state.
 *
 * IT COMES FROM THE REQUEST, not from a build-time constant. The Worker answers
 * on a workers.dev host in every stage and on the apex only in production; a
 * baked origin would make staging emit canonicals pointing at production, which
 * asks Google to fold a stage nobody should be indexing into the live site.
 * `isProductionHost` is how the crawl surfaces tell the two apart instead.
 */
import { PRODUCTION_ZONE } from "platform.names";

/**
 * Is this the hostname the public site is published under?
 *
 * The apex and `www.` both count — the zone's route table may answer on either,
 * and a `www` request is the same site rather than a stage. Everything else —
 * `*.workers.dev`, a preview alias, localhost — is a stage, and stages are kept
 * out of every index. See `src/pages/robots.txt.ts`.
 */
export const isProductionHost = (hostname: string): boolean =>
  hostname === PRODUCTION_ZONE || hostname === `www.${PRODUCTION_ZONE}`;

/**
 * The canonical form of a path: exactly one leading slash, no trailing one
 * except at the root, and no query or fragment.
 *
 * THE TRAILING SLASH IS THE POINT. `SiteHeader` links `/shop/` while
 * `SiteFooter` links `/shipping`, and Astro serves both spellings of every
 * route — so without one rule, the canonical tag on a page reached through the
 * nav would disagree with the one reached through the footer, and a crawler
 * would treat them as two pages with duplicate content. Dropping the slash is
 * the arbitrary half of the choice; applying it in exactly one place is not.
 */
export const canonicalPath = (path: string): string => {
  const [withoutFragment = ""] = path.split("#");
  const [pathname = ""] = withoutFragment.split("?");
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const trimmed = withLeadingSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

/** `https://origin/path`, canonicalised. The only way this site spells a URL. */
export const absoluteUrl = (origin: string, path: string): string =>
  `${origin.replace(/\/+$/, "")}${canonicalPath(path)}`;

/**
 * The markdown twin of a page — `/shop/field-tee` → `/shop/field-tee.md`.
 *
 * The convention llms.txt describes is "the same URL with `.md` appended", and
 * it is what Anthropic, Stripe and Mintlify all publish. The root is the one
 * case the rule does not spell: `/.md` is not a path, so home takes `/index.md`.
 */
export const markdownPath = (path: string): string => {
  const canonical = canonicalPath(path);
  return canonical === "/" ? "/index.md" : `${canonical}.md`;
};
