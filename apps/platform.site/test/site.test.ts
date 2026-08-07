/**
 * URL SPELLING, which is the only thing standing between this site and being
 * indexed twice.
 *
 * `SiteHeader` links `/shop/` and `SiteFooter` links `/shipping`, and Astro
 * serves both spellings of both. Everything downstream — the canonical tag, the
 * sitemap's `<loc>`, the `.md` twin's address, the `@id` in the JSON-LD graph —
 * is derived from `canonicalPath`, so a page reached through the nav and the
 * same page reached through the footer have to come out identical here or they
 * come out as two pages to a crawler.
 */
import { describe, expect, test } from "bun:test";

import { absoluteUrl, canonicalPath, isProductionHost, markdownPath } from "../src/core/site.ts";

describe("canonicalPath", () => {
  test("one spelling wins whichever the link used", () => {
    expect(canonicalPath("/shop/")).toBe("/shop");
    expect(canonicalPath("/shop")).toBe("/shop");
    expect(canonicalPath("shop")).toBe("/shop");
    expect(canonicalPath("/shop///")).toBe("/shop");
  });

  test("the root keeps its slash — the empty string is not a path", () => {
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("")).toBe("/");
  });

  test("query and fragment are not part of the address a crawler should hold", () => {
    expect(canonicalPath("/shop/field-tee?utm_source=x")).toBe("/shop/field-tee");
    expect(canonicalPath("/about#statement")).toBe("/about");
    expect(canonicalPath("/about/?a=1#b")).toBe("/about");
  });
});

describe("absoluteUrl", () => {
  test("joins without doubling the slash whichever side carried it", () => {
    expect(absoluteUrl("https://somewhatintelligent.ca", "/shop")).toBe(
      "https://somewhatintelligent.ca/shop",
    );
    expect(absoluteUrl("https://somewhatintelligent.ca/", "shop/")).toBe(
      "https://somewhatintelligent.ca/shop",
    );
  });

  test("the root is not left as a bare origin", () => {
    expect(absoluteUrl("https://somewhatintelligent.ca", "/")).toBe(
      "https://somewhatintelligent.ca/",
    );
  });
});

describe("markdownPath", () => {
  test("appends .md, which is the llms.txt convention", () => {
    expect(markdownPath("/about/")).toBe("/about.md");
    expect(markdownPath("/shop/field-tee")).toBe("/shop/field-tee.md");
  });

  test("the root takes index.md, because `/.md` is not a path", () => {
    expect(markdownPath("/")).toBe("/index.md");
  });
});

describe("isProductionHost", () => {
  test("the apex and www are the published site", () => {
    expect(isProductionHost("somewhatintelligent.ca")).toBe(true);
    expect(isProductionHost("www.somewhatintelligent.ca")).toBe(true);
  });

  /**
   * THE CASE THIS FUNCTION EXISTS FOR. Every stage answers on a workers.dev
   * host, and a stage that reads as production publishes a sitemap and a
   * crawlable robots.txt for a copy of the storefront — which is how the copy
   * ends up outranking the original.
   */
  test("every stage is not", () => {
    expect(isProductionHost("platformcommerce-site-dev.workers.dev")).toBe(false);
    expect(isProductionHost("localhost")).toBe(false);
    /** A lookalike suffix is not the zone. */
    expect(isProductionHost("evil-somewhatintelligent.ca")).toBe(false);
    expect(isProductionHost("somewhatintelligent.ca.example.com")).toBe(false);
  });
});
