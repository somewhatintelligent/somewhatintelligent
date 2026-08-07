/**
 * `GET /index.md` — the home page as markdown. See `core/page-markdown.ts` for
 * what these twins are for and which pages have one.
 *
 * `/index.md` rather than `/.md`, which is not a path. The llms.txt convention
 * spells the root case the same way.
 */
import type { APIRoute } from "astro";

import { homeMarkdown } from "../core/page-markdown.ts";
import { CACHE_STATIC, markdownResponse } from "../lib/text-response.ts";
import { HOME_DOCUMENT } from "../lib/home-document.ts";

export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  markdownResponse(homeMarkdown(url.origin, HOME_DOCUMENT), { maxAge: CACHE_STATIC });
