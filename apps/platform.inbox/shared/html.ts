// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * HTML escaping and quoting, shared by the browser and the Worker.
 *
 * Both sides had their own copy, and the copies disagreed on the one thing
 * that matters here: the Worker stripped `<style>`/`<script>` BLOCKS before
 * dropping tags, the app dropped tags only — so text inside a `<script>` ended
 * up in an app-built quote block. The Worker's rule is the one kept.
 *
 * They also disagreed on the separator: the app replaced a tag with nothing
 * (`a<br>b` → `ab`), the Worker with a space. A space is kept, for the same
 * reason a snippet should not read `ab`.
 */
import { formatQuotedDate } from "./dates";

/** All five OWASP-recommended characters, so the result is safe as text AND in an attribute. */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tags to spaces, whitespace collapsed. `<style>`/`<script>` go first, contents and all. */
export function stripHtmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain text as an HTML block that keeps its line breaks.
 *
 * Belt and suspenders: `white-space:pre-wrap` for clients that honour inline
 * styles, `<br>` for the ones that strip them (Outlook).
 */
export function textToHtml(text: string): string {
  if (!text) return "";
  return `<div style="white-space:pre-wrap">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

/**
 * The `> On <date>, <sender> wrote:` block a reply opens with.
 *
 * The body is flattened to plain text and escaped rather than passed through.
 * Original HTML renders safely in the sandboxed iframe the reader uses, but a
 * quote block is injected into the compose editor and into the outgoing
 * message, where raw HTML would run.
 */
export function buildQuotedReplyBlock(original: {
  date?: string;
  sender?: string;
  body?: string;
}): string {
  if (!original.body) return "";

  const sender = escapeHtml(original.sender || "unknown");
  const date = escapeHtml(formatQuotedDate(original.date || ""));
  const body = escapeHtml(stripHtmlToText(original.body)).replace(/\n/g, "<br>");

  return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${date}, ${sender} wrote:<br><br>${body}</blockquote>`;
}
