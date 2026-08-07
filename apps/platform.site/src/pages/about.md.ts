/** `GET /about.md` — the about page as markdown. */
import type { APIRoute } from "astro";

import { aboutMarkdown } from "../core/page-markdown.ts";
import { ABOUT_DOCUMENT } from "../lib/about-document.ts";
import { CACHE_STATIC, markdownResponse } from "../lib/text-response.ts";

export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  markdownResponse(aboutMarkdown(url.origin, ABOUT_DOCUMENT), { maxAge: CACHE_STATIC });
