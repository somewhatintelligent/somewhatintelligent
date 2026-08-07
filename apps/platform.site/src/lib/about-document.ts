/**
 * The about page's copy, committed.
 *
 * Same arrangement as `home-document.ts`: in the site this replaces, `/about`
 * read this document from the Publisher service and fell back to a site-local
 * default when the page had never been published. The scaffold keeps ONLY the
 * fallback — the shape is unchanged, so the read can be reintroduced later as
 * the thing that overrides it, and nothing here waits on a binding.
 */

export interface AboutDocument {
  readonly seo: {
    readonly title: string;
    readonly description: string;
    readonly imageMediaId: string | null;
  };
  readonly eyebrow: string;
  readonly title: string;
  readonly statement: string;
  /** Portrait media id, or null for the placeholder plate. */
  readonly primaryMediaId: string | null;
  /** A third evidence figure, or null for the two committed ones alone. */
  readonly secondaryMediaId: string | null;
  readonly lowerContent: string | null;
}

export const ABOUT_DOCUMENT: AboutDocument = {
  seo: {
    title: "Apostoli — somewhatintelligent",
    description:
      "Apostoli is the publisher, writer, and operator responsible for somewhatintelligent. Not for hire.",
    imageMediaId: null,
  },
  eyebrow: "ABOUT",
  title: "APOSTOLI",
  statement:
    "I build systems because I like knowing how things work. I like being the one who decides how things work. I make art because I like having license to comment on how they already do. Should I be entrusted with such power? No less than anyone else should be entrusted to make such a judgement.",
  primaryMediaId: null,
  secondaryMediaId: null,
  lowerContent: "Selected work — coming soon.",
};
