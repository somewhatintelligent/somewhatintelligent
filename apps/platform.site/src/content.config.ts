/**
 * THE WRITING, AS FILES IN THIS REPOSITORY.
 *
 * The index used to read a keyset page of published texts from a Publisher
 * service over a binding. Nothing serves that any more, and the texts are prose
 * that changes when their author edits a file — not operator-authored rows that
 * change between deploys. So they live here, are compiled by Astro's own
 * Markdown pipeline at build time, and the routes that read them prerender.
 *
 * `deck` IS A SENTENCE FROM THE TEXT, not a summary written about it. The index
 * masthead prints it at display size beside the title; a paraphrase reads as
 * marketing copy in that slot, and a real sentence reads as the argument.
 *
 * NO `readingMinutes` FIELD. It is counted from the body — see
 * `core/writing-view.ts`. A number typed into frontmatter is a number that goes
 * stale on the next edit and that nobody notices is lying.
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
// `astro/zod`, not `astro:content`'s re-export and not the standalone `zod` in
// the workspace: the re-export is deprecated for removal, and the loose package
// is a different major than the one Astro validates schemas with.
import { z } from "astro/zod";

const writing = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string(),
    /** A verbatim sentence from the text, used as its pull-quote. */
    deck: z.string(),
    kind: z.enum(["essay", "paper", "note"]),
    /** When the text was finished, not when the file was touched. */
    date: z.coerce.date(),
    /** Set only when the text itself was revised after publication. */
    updated: z.coerce.date().optional(),
    description: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing };
