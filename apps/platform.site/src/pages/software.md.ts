/** `GET /software.md` — the software registry as markdown. */
import type { APIRoute } from "astro";

import { placeholderMarkdown } from "../core/page-markdown.ts";
import { markdownResponse } from "../lib/markdown-response.ts";

export const prerender = false;

/** The registry is a later track; the page and its twin say so identically. */
export const GET: APIRoute = ({ url }) =>
  markdownResponse(
    placeholderMarkdown(
      url.origin,
      "/software",
      "Software",
      "Systems and tools published by somewhatintelligent.",
      "Nothing published yet.",
    ),
  );
