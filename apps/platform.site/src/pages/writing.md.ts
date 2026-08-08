/** `GET /writing.md` — the writing index as markdown. */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

import { writingMarkdown } from "../core/page-markdown.ts";
import { publishedRows } from "../core/writing-view.ts";
import { CACHE_STATIC, markdownResponse } from "../lib/text-response.ts";
import { WRITING_DOCUMENT } from "../lib/writing-document.ts";

export const prerender = false;

/**
 * The texts come from the same collection and the same `publishedRows` the HTML
 * index uses, which is the whole point of a twin: two renderings of one list,
 * not two lists. This route used to serve a placeholder saying nothing was
 * published — true when the index was a coming-soon plate, and a lie the moment
 * a text landed. `/writing` advertises this file via `rel="alternate"`, so the
 * lie was one an agent would have been sent to.
 */
export const GET: APIRoute = async ({ url }) => {
  const texts = publishedRows(
    (await getCollection("writing")).map((entry) => ({
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
  );

  return markdownResponse(
    writingMarkdown(
      url.origin,
      WRITING_DOCUMENT.heading,
      WRITING_DOCUMENT.seo.description,
      texts,
      WRITING_DOCUMENT.emptyMessage,
    ),
    { maxAge: CACHE_STATIC },
  );
};
