/** `GET /writing.md` — the writing index as markdown. */
import type { APIRoute } from "astro";

import { placeholderMarkdown } from "../core/page-markdown.ts";
import { CACHE_STATIC, markdownResponse } from "../lib/text-response.ts";
import { WRITING_DOCUMENT } from "../lib/writing-document.ts";

export const prerender = false;

/**
 * The list is empty until the publisher read is reintroduced — see
 * `writing/index.astro`. The twin says the same thing the page says rather than
 * being absent, because a 404 here reads as "this site has no writing surface"
 * rather than "nothing is published on it yet".
 */
export const GET: APIRoute = ({ url }) =>
  markdownResponse(
    placeholderMarkdown(
      url.origin,
      "/writing",
      WRITING_DOCUMENT.heading,
      WRITING_DOCUMENT.seo.description,
      WRITING_DOCUMENT.emptyMessage,
    ),
    { maxAge: CACHE_STATIC },
  );
