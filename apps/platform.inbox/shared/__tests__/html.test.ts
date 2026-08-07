// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, test } from "vite-plus/test";
import { buildQuotedReplyBlock, escapeHtml, stripHtmlToText, textToHtml } from "../html";

describe("escapeHtml", () => {
  test("all five characters, so the result is safe as text AND in an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("the ampersand goes first, so an escape is not escaped twice", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  test("empty and falsy input is an empty string, never a throw", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("stripHtmlToText", () => {
  test("a tag becomes a SPACE, so neighbouring words do not fuse", () => {
    expect(stripHtmlToText("<p>one</p><p>two</p>")).toBe("one two");
  });

  // A script/style block is excised WHOLE — tags and contents in one cut — so
  // unlike an ordinary tag it leaves no separating space behind.
  test("script CONTENTS are dropped, not just the tags around them", () => {
    expect(stripHtmlToText("hi<script>alert(1)</script>there")).toBe("hithere");
  });

  test("style contents go the same way", () => {
    expect(stripHtmlToText("hi<style>.a{color:red}</style>there")).toBe("hithere");
  });

  test("whitespace collapses and the edges are trimmed", () => {
    expect(stripHtmlToText("  <b>  spaced   out  </b>  ")).toBe("spaced out");
  });

  test("empty input is an empty string", () => {
    expect(stripHtmlToText("")).toBe("");
  });
});

describe("textToHtml", () => {
  test("carries the newline twice — as pre-wrap AND as <br>, for clients that strip styles", () => {
    const html = textToHtml("a\nb");
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("a<br>b");
  });

  test("the text is escaped before it is wrapped", () => {
    expect(textToHtml("<script>")).toContain("&lt;script&gt;");
  });

  test("empty input produces no wrapper at all", () => {
    expect(textToHtml("")).toBe("");
  });
});

describe("buildQuotedReplyBlock", () => {
  const original = { date: "2026-01-15T10:30:00Z", sender: "a@example.com", body: "<p>hello</p>" };

  test("names the sender and quotes the body as plain text", () => {
    const block = buildQuotedReplyBlock(original);
    expect(block).toContain("a@example.com");
    expect(block).toContain("hello");
    expect(block).toContain("<blockquote");
  });

  test("a body with no content is no block, not an empty quote", () => {
    expect(buildQuotedReplyBlock({ ...original, body: "" })).toBe("");
  });

  test("an unknown sender is named rather than left blank", () => {
    expect(buildQuotedReplyBlock({ ...original, sender: undefined })).toContain("unknown");
  });

  test("markup in the quoted body cannot execute — it arrives escaped", () => {
    const block = buildQuotedReplyBlock({
      ...original,
      body: `<img src=x onerror="alert(1)">caption`,
    });
    expect(block).not.toContain("onerror");
    expect(block).toContain("caption");
  });

  test("an address in angle brackets survives instead of vanishing as a tag", () => {
    const block = buildQuotedReplyBlock({ ...original, sender: "Ann <ann@example.com>" });
    expect(block).toContain("&lt;ann@example.com&gt;");
  });

  test("a script in the quoted body contributes nothing to the quote", () => {
    const block = buildQuotedReplyBlock({ ...original, body: "<script>steal()</script>kept" });
    expect(block).not.toContain("steal");
    expect(block).toContain("kept");
  });
});
