/**
 * `GET /writing/<slug>.md` — one text as markdown, which is what it already was.
 *
 * NO 503 BRANCH, unlike the object twin beside it. That route reads a binding
 * and has to tell "no such product" apart from "the catalogue is down", because
 * answering 404 to an outage would report a live object as withdrawn. This
 * reads a data store compiled into the Worker: if it resolves at all, it has
 * every text, so a miss is a miss.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

import { textMarkdown } from "../../core/page-markdown.ts";
import { publishedRows } from "../../core/writing-view.ts";
import { markdownResponse } from "../../lib/text-response.ts";

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const slug = params.slug;
  if (!slug) return new Response(null, { status: 404 });

  const entries = await getCollection("writing");

  /**
   * Resolved against `publishedRows` rather than the collection, so a draft is
   * a 404 here exactly as it is on the page. A twin that served an unfinished
   * text would be the back door around the only gate.
   */
  const row = publishedRows(
    entries.map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      deck: entry.data.deck,
      kind: entry.data.kind,
      date: entry.data.date,
      updated: entry.data.updated,
      draft: entry.data.draft,
      body: entry.body ?? "",
    })),
    { includeDrafts: import.meta.env.DEV },
  ).find((candidate) => candidate.slug === slug);

  const entry = row ? entries.find((candidate) => candidate.id === row.slug) : undefined;
  if (!row || !entry) return new Response(null, { status: 404 });

  return markdownResponse(
    textMarkdown(url.origin, {
      slug: row.slug,
      title: row.title,
      deck: row.deck,
      kind: row.kind,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      readingMinutes: row.readingMinutes,
      description: entry.data.description,
      body: entry.body ?? "",
    }),
  );
};
