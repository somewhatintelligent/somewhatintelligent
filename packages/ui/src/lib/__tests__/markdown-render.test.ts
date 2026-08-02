import { describe, expect, it } from "vite-plus/test";

import { renderMarkdown, slugifyWikilinkTarget } from "../markdown-render";

// Mirrors workers/site/src/lib/__tests__/markdown.test.ts — the editor preview
// is a copy of the canonical render and must keep the same safety guarantees.

describe("renderMarkdown render-safety", () => {
  it("renders a raw <script> block inert", () => {
    const html = renderMarkdown('before\n\n<script>alert("xss")</script>\n\nafter');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an <img onerror> injection", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain("&lt;img");
  });

  it("escapes a raw <iframe>", () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toMatch(/<iframe/i);
    expect(html).toContain("&lt;iframe");
  });

  it("neutralizes a javascript: link (no anchor emitted for it)", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toMatch(/href\s*=\s*["']?javascript:/i);
  });
});

describe("renderMarkdown links", () => {
  it("adds rel=noopener to external links", () => {
    const html = renderMarkdown("[site](https://example.com)");
    expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com"[^>]*rel="noopener noreferrer"/);
  });

  it("leaves internal links without a noopener rel", () => {
    const html = renderMarkdown("[about](/about/)");
    expect(html).toContain('href="/about/"');
    expect(html).not.toMatch(/href="\/about\/"[^>]*rel=/);
  });
});

describe("renderMarkdown wikilinks", () => {
  it("resolves [[slug]] to an internal /writing link", () => {
    const html = renderMarkdown("see [[my-post]] here");
    expect(html).toContain('<a href="/writing/my-post">my-post</a>');
  });

  it("resolves [[slug|label]] to a labelled /writing link", () => {
    const html = renderMarkdown("see [[my-post|My Post]] here");
    expect(html).toContain('<a href="/writing/my-post">My Post</a>');
  });

  it("normalizes a target with spaces/case into a safe slug", () => {
    const html = renderMarkdown("[[Hello World]]");
    expect(html).toContain('href="/writing/hello-world"');
  });

  it("does not resolve wikilinks inside inline code", () => {
    const html = renderMarkdown("`[[not-a-link]]`");
    expect(html).not.toContain('href="/writing/not-a-link"');
    expect(html).toContain("[[not-a-link]]");
  });

  it("leaves an empty-target wikilink as literal text", () => {
    const html = renderMarkdown("[[ ]]");
    expect(html).not.toContain("/writing/");
    expect(html).toContain("[[ ]]");
  });
});

describe("slugifyWikilinkTarget", () => {
  it("collapses non-alphanumerics and trims edges", () => {
    expect(slugifyWikilinkTarget("  My Post!! ")).toBe("my-post");
  });

  it("returns null for an empty result", () => {
    expect(slugifyWikilinkTarget("   ")).toBeNull();
    expect(slugifyWikilinkTarget("!!!")).toBeNull();
  });
});
