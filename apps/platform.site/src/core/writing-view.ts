/**
 * EVERY DECISION THE WRITING ROUTES MAKE, made in one place and tested without
 * a renderer — what counts as a word, which texts a build publishes, and the
 * order they appear in. `WritingIndex.astro` is the shape; this is the answer.
 *
 * Deliberately ignorant of `astro:content`. It takes a plain `WritingSource`,
 * which is what the routes narrow a `CollectionEntry` down to, so the tests
 * construct inputs as object literals instead of standing up a content layer.
 */

/**
 * 220, which is the low end of adult silent-reading rates for prose and the
 * right end to be on: a text that reads faster than promised costs the reader
 * nothing, and one that reads slower makes the estimate a small lie. These are
 * dense essays with block quotes and citations, not listicles.
 */
export const WORDS_PER_MINUTE = 220;

/** A collection entry, narrowed to what these functions actually read. */
export interface WritingSource {
  readonly slug: string;
  readonly title: string;
  readonly deck: string;
  readonly kind: string;
  readonly date: Date;
  readonly updated?: Date | undefined;
  readonly draft?: boolean | undefined;
  /** Raw Markdown body — frontmatter already stripped by the loader. */
  readonly body: string;
}

/** One row of the index, and the panel it populates when hovered. */
export interface WritingRow {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly deck: string;
  readonly kind: string;
  readonly publishedAt: number;
  readonly updatedAt: number | null;
  readonly readingMinutes: number;
}

/**
 * Minutes to read, counted from the prose rather than declared in frontmatter.
 *
 * WHAT IS NOT PROSE: fenced and inline code, and the URL half of a link — a
 * Works Cited section is mostly URLs, and counting them would add minutes to
 * the estimate for text nobody reads. Link labels ARE counted, since those are
 * words on the page. Markdown punctuation is stripped before the split so that
 * a `>` opening a block quote is not counted as a word, and tokens with no
 * letter or digit in them are dropped for the same reason.
 *
 * Never returns 0 — "0 min" reads as a broken field, and a text short enough to
 * earn it is still a text you spend a moment on.
 */
export function readingMinutes(markdown: string): number {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|]+/g, " ");
  const words = prose.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Project a source into the row the index renders. */
export function toRow(source: WritingSource): WritingRow {
  return {
    slug: source.slug,
    href: `/writing/${source.slug}/`,
    title: source.title,
    deck: source.deck,
    kind: source.kind,
    publishedAt: source.date.getTime(),
    updatedAt: source.updated?.getTime() ?? null,
    readingMinutes: readingMinutes(source.body),
  };
}

/**
 * The index, newest first — and in a production build, published only.
 *
 * DRAFTS SURVIVE A DEV BUILD so a text can be laid out on the real page before
 * it is finished, and are dropped from a production one so an unfinished text
 * is not merely unlinked but absent: these routes prerender, and an unlisted
 * file would otherwise still deploy as a reachable URL.
 *
 * Ties break on slug so a build is reproducible when two texts share a date;
 * `sort` is not required to be stable across engines and a shuffling index
 * would show up as a diff in the deployed assets for no reason.
 */
export function publishedRows(
  sources: readonly WritingSource[],
  options: { readonly includeDrafts: boolean },
): readonly WritingRow[] {
  return sources
    .filter((source) => options.includeDrafts || source.draft !== true)
    .map(toRow)
    .sort((a, b) => b.publishedAt - a.publishedAt || a.slug.localeCompare(b.slug));
}
