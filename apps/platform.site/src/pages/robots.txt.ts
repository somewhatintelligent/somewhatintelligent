/**
 * `GET /robots.txt` — the crawl policy, and the one file that decides whether
 * any of the rest of this work is ever read.
 *
 * SERVED, NOT STATIC, for one reason: this Worker answers on a workers.dev host
 * in every stage and on the apex only in production. A committed file would say
 * the same thing on both, and the thing it has to say is opposite —
 * `Disallow: /` on a stage, because a staging copy of the storefront competing
 * with the real one in an index is the classic way to lose the real one.
 *
 * NAMED GROUPS RESTATE THE DISALLOWS. Google's robots.txt specification is
 * explicit that a crawler obeys the MOST SPECIFIC matching group and does not
 * merge it with `*` — so an `User-agent: GPTBot` group that only said `Allow: /`
 * would silently hand GPTBot the cart and the order pages that `*` protects.
 * The two groups are duplicated on purpose.
 */
import type { APIRoute } from "astro";

import { absoluteUrl, isProductionHost } from "../core/site.ts";

export const prerender = false;

/**
 * Paths no crawler has any use for. Each is either ONE PERSON'S TRANSACTION or
 * a machine surface: a cart is per-browser and empty to anyone else, an order
 * is a stranger's receipt, and `/api` answers POSTs.
 *
 * `/media` is deliberately NOT here — product photographs are what image search
 * and every social card resolve, and blocking them would break the cards this
 * site just went to the trouble of emitting.
 */
const DISALLOW = ["/cart", "/orders/", "/api/"] as const;

/**
 * THE AI CRAWLERS, NAMED. Functionally this group is identical to `*`, and that
 * is the point: naming them says the policy was decided rather than defaulted,
 * and it gives a single place to split one out and refuse it later.
 *
 * The three kinds behave differently and are worth telling apart:
 *   training   GPTBot, ClaudeBot, Google-Extended, CCBot, Meta-ExternalAgent
 *   retrieval  OAI-SearchBot, Claude-SearchBot, PerplexityBot — these are what
 *              put a citation in an answer, and refusing them costs traffic
 *   fetchers   ChatGPT-User, Claude-User, Perplexity-User — a person asked for
 *              this page by name; refusing is refusing a reader
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Amazonbot",
  "Bytespider",
  "CCBot",
] as const;

/**
 * Cloudflare's Content Signals Policy — a machine-readable statement of what
 * may be done with the content AFTER it is fetched, which robots.txt on its own
 * has never been able to express.
 *
 *   search=yes     index and rank it, and link back. Obviously yes.
 *   ai-input=yes   quote it in an answer, with attribution. This is how a
 *                  studio nobody has heard of gets read at all.
 *   ai-train=no    do not put it in the weights. The objects and the texts are
 *                  the product; there is no version of that trade worth making.
 *
 * A SIGNAL, NOT A LOCK. Nothing enforces it — an operator who wants it enforced
 * pairs it with Cloudflare's bot controls. Saying nothing, per the policy,
 * grants nothing and forbids nothing, which is the one outcome with no upside.
 */
const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no";

const group = (agents: readonly string[]): string =>
  [
    ...agents.map((agent) => `User-agent: ${agent}`),
    CONTENT_SIGNAL,
    "Allow: /",
    ...DISALLOW.map((path) => `Disallow: ${path}`),
  ].join("\n");

export const GET: APIRoute = ({ url }) => {
  const origin = url.origin;

  const body = isProductionHost(url.hostname)
    ? [
        "# somewhatintelligent — objects, systems, texts",
        "#",
        "# Content signals below follow the Cloudflare Content Signals Policy:",
        "# https://contentsignals.org/",
        "",
        group(["*"]),
        "",
        "# Named so the choice is on the record rather than inherited. These",
        "# groups do not merge with the one above — see the module comment.",
        group(AI_AGENTS),
        "",
        `Sitemap: ${absoluteUrl(origin, "/sitemap.xml")}`,
        "",
      ].join("\n")
    : [
        "# Not the published site. Every stage answers on a workers.dev host and",
        "# must stay out of every index, or it competes with the real storefront.",
        "User-agent: *",
        "Disallow: /",
        "",
      ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      /**
       * An hour. Long enough that a crawl storm does not re-render this, short
       * enough that flipping a signal takes effect the same afternoon —
       * robots.txt is the file you most want to be able to change quickly.
       */
      "cache-control": "public, max-age=3600",
    },
  });
};
