/**
 * THE THREE FILES A CRAWLER READS BEFORE IT READS A PAGE — the sitemap, the
 * llms.txt index, and the markdown twins they both point at.
 *
 * The failure mode they share is silence. A sitemap that lists a `noindex` URL,
 * an index whose links 404, a twin priced in the wrong currency — none of them
 * break a page, and none of them surface anywhere a person is looking.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { StorefrontProductDTO } from "platform.commerce/contracts";

import { llmsTxt } from "../src/core/llms.ts";
import { productMarkdown, shopMarkdown } from "../src/core/page-markdown.ts";
import {
  escapeXml,
  NOT_INDEXED,
  sitemapPaths,
  sitemapXml,
  STATIC_PATHS,
} from "../src/core/sitemap.ts";
import { canonicalPath, markdownPath } from "../src/core/site.ts";

const ORIGIN = "https://somewhatintelligent.ca";

const product = (overrides: Partial<StorefrontProductDTO> = {}): StorefrontProductDTO => ({
  slug: "friend-001",
  title: "I think we should be friends",
  descriptionMarkdown: "I mean in the C++ way.\n\nSecond paragraph.",
  detailsMarkdown: null,
  sizeGuide: null,
  priceCents: 6_900,
  currency: "cad",
  version: "1.0.0",
  media: [{ href: "/media/a", alt: "front" }],
  variants: [
    { id: "v-s", size: "S", available: true },
    { id: "v-m", size: "M", available: false },
  ],
  ...overrides,
});

/**
 * EVERY ROUTE IS ACCOUNTED FOR, one way or the other.
 *
 * `STATIC_PATHS` is hand-maintained — see `core/sitemap.ts` for why it cannot
 * be derived from Astro here — so the risk is not that it lists something wrong
 * but that a new page never gets added and is silently never crawled. Walking
 * `src/pages/` turns that from an invisible omission into a failing test with
 * the missing path in the message.
 */
describe("route inventory", () => {
  const PAGES = resolve(import.meta.dirname, "../src/pages");

  /** `src/pages/shop/index.astro` -> `/shop`; `src/pages/shop/[slug].md.ts` -> `/shop/[slug].md`. */
  const routeOf = (file: string): string => {
    const withoutRoot = file.slice(PAGES.length).replace(/\\/g, "/");
    const withoutExt = withoutRoot.replace(/\.(astro|ts)$/, "");
    const withoutIndex = withoutExt.replace(/\/index$/, "");
    return withoutIndex === "" ? "/" : withoutIndex;
  };

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(astro|ts)$/.test(entry.name) ? [full] : [];
    });

  test("no route is missing from both the sitemap and the not-indexed list", () => {
    const known = new Set([...STATIC_PATHS, ...NOT_INDEXED]);
    const unaccounted = walk(PAGES)
      .map(routeOf)
      .filter((route) => !known.has(route));
    expect(unaccounted).toEqual([]);
  });

  /** The other direction: a path listed here that no file serves is a 404 in the sitemap. */
  test("no listed path has lost its route file", () => {
    const actual = new Set(walk(PAGES).map(routeOf));
    expect([...STATIC_PATHS, ...NOT_INDEXED].filter((path) => !actual.has(path))).toEqual([]);
  });
});

describe("sitemap", () => {
  /**
   * A SITEMAP NAMING A `noindex` URL IS A CONTRADICTION Search Console reports
   * as an error. `/cart` and `/orders/<number>` are `noindex` in the markup, so
   * they must not be here — and `/404` is not a page at all.
   */
  test("lists nothing the markup tells a crawler to ignore", () => {
    for (const excluded of ["/cart", "/orders", "/404"]) {
      expect(STATIC_PATHS).not.toContain(excluded);
    }
  });

  test("every static path is already in canonical spelling", () => {
    for (const path of STATIC_PATHS) {
      expect(canonicalPath(path)).toBe(path);
    }
  });

  /**
   * The caller unions two markets because `listStorefront` hides a product with
   * no live row in the market it asked about. A product on sale in both is one
   * URL — the market changes prices, never addresses.
   */
  test("a product sold in both markets appears once", () => {
    const paths = sitemapPaths(["a", "b", "a"]);
    expect(paths.filter((path) => path === "/shop/a")).toHaveLength(1);
    expect(paths).toEqual([...STATIC_PATHS, "/shop/a", "/shop/b"]);
  });

  test("a slug carrying XML metacharacters does not break the document", () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
    const xml = sitemapXml(ORIGIN, ["/shop/a&b"]);
    expect(xml).toContain("<loc>https://somewhatintelligent.ca/shop/a&amp;b</loc>");
    expect(xml).not.toContain("a&b</loc>");
  });

  /**
   * `<changefreq>` and `<priority>` are ignored by Google outright, and every
   * `<lastmod>` this could emit would be invented — the storefront DTO carries
   * no modification time. Emitting one anyway is what makes the field worthless
   * for the sites that could have used it.
   */
  test("claims no freshness it cannot know", () => {
    const xml = sitemapXml(ORIGIN, ["/shop/a"]);
    expect(xml).not.toContain("lastmod");
    expect(xml).not.toContain("changefreq");
    expect(xml).not.toContain("priority");
  });
});

describe("llms.txt", () => {
  const body = llmsTxt({ origin: ORIGIN, products: [product()], reachable: true });

  /**
   * THE SPEC'S SHAPE: an H1 (the only required section), then a blockquote
   * summary, then H2 sections of link lists. `## Optional` is reserved — it
   * marks what an agent may skip for a shorter context.
   */
  test("opens with the H1 and blockquote the format requires", () => {
    const [first, blank, quote] = body.split("\n");
    expect(first).toBe("# somewhatintelligent");
    expect(blank).toBe("");
    expect(quote?.startsWith("> ")).toBe(true);
  });

  test("carries the reserved Optional heading for the policy pages", () => {
    expect(body).toContain("\n## Optional\n");
    expect(body).toContain(`[Refunds](${ORIGIN}/refunds)`);
  });

  test("object links point at the markdown twins, not the HTML", () => {
    expect(body).toContain(`[I think we should be friends](${ORIGIN}/shop/friend-001.md)`);
  });

  /**
   * An empty catalogue and an unreachable one must not read identically. The
   * whole reason the HTML page distinguishes them is that an outage reported as
   * "nothing published" is the outage nobody reports.
   */
  test("an unreachable catalogue says so instead of reading as an empty shop", () => {
    const broken = llmsTxt({ origin: ORIGIN, products: [], reachable: false });
    expect(broken).toContain("could not be read");
    expect(broken).not.toContain("No objects are published yet.");
  });

  test("every link in it is absolute", () => {
    const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href?.startsWith("https://")).toBe(true);
  });
});

describe("markdown twins", () => {
  const body = productMarkdown(ORIGIN, product());

  test("state the facts an agent would otherwise scrape out of the markup", () => {
    expect(body).toContain("# I think we should be friends");
    expect(body).toContain("**Price:** $69 CAD");
    expect(body).toContain("**Release:** 1.0.0");
    expect(body).toContain(`**Buy:** ${ORIGIN}/shop/friend-001`);
  });

  test("say which sizes are buyable rather than listing them flat", () => {
    expect(body).toContain("- S — in stock");
    expect(body).toContain("- M — sold out");
  });

  test("an object with no sizes says so instead of printing an empty list", () => {
    const sizeless = productMarkdown(ORIGIN, product({ variants: [] }));
    expect(sizeless).toContain("No sizes published.");
  });

  test("image links are absolute — a twin is read away from its origin", () => {
    expect(body).toContain(`![front](${ORIGIN}/media/a)`);
  });

  /** Same split the HTML page makes, for the same reason. */
  test("an unreachable ledger is distinguishable from an empty one", () => {
    const doc = { seo: { title: "Objects", description: "d" } };
    expect(shopMarkdown(ORIGIN, doc, [], true)).toContain("No objects are published yet.");
    expect(shopMarkdown(ORIGIN, doc, [], false)).toContain("unreachable");
  });

  /**
   * The `<link rel="alternate">` a page advertises and the route that serves
   * the twin have to agree, or the advertised address 404s.
   */
  test("the advertised address is the one the routes serve", () => {
    expect(markdownPath("/shop/friend-001")).toBe("/shop/friend-001.md");
    expect(markdownPath("/about/")).toBe("/about.md");
    expect(markdownPath("/")).toBe("/index.md");
  });
});
