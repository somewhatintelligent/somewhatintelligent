/**
 * The writing index's copy and the shape of the list it renders.
 *
 * In the site this replaces, `/writing` read the page document and a keyset
 * page of published texts from the Publisher service, falling back to this copy
 * field-by-field when the page had never been published. The scaffold keeps the
 * copy and the TYPES: `WritingIndex.astro` is a pure function of them, so it
 * renders identically the day a list arrives — today the route hands it an
 * empty list and the coming-soon fallback renders.
 */

/** A published media reference as the public read surface returns it. */
export interface PublicMediaRef {
  readonly href: string;
  readonly alt: string;
}

/** One row of the index — the summary shape the text list returns. */
export interface PublishedTextSummary {
  readonly slug: string;
  readonly version: string;
  readonly title: string;
  readonly deck: string | null;
  readonly excerpt: string;
  readonly publishedAt: number;
  readonly tags: readonly string[];
  readonly heroMedia: PublicMediaRef | null;
}

export interface WritingDocument {
  readonly seo: {
    readonly title: string;
    readonly description: string;
  };
  readonly heading: string;
  readonly deck: string;
  readonly emptyMessage: string;
}

export const WRITING_DOCUMENT: WritingDocument = {
  seo: {
    title: "Writing — somewhatintelligent",
    description: "Writing by Apostoli, published by somewhatintelligent.",
  },
  heading: "Writing",
  deck: "arguments, notes, and revisions",
  emptyMessage: "No texts published yet.",
};
