/**
 * The home page's copy, committed.
 *
 * In the site this replaces, `/` read this document from the Publisher service
 * and fell back to a site-local default when the page had never been published.
 * The scaffold keeps ONLY the fallback: the shape is the same, so the read can
 * be reintroduced later as the thing that overrides it, but nothing here waits
 * on a binding — which is what makes a deploy of this stack prove the SSR path
 * and nothing else.
 *
 * SSR still happens: `/` is an on-demand route, so the Worker renders this on
 * every request rather than serving a prerendered file.
 */

/** One of the four records on the home grid. */
export interface HomeSection {
  readonly eyebrow: string;
  readonly body: string;
  readonly actionLabel: string;
}

export interface HomeDocument {
  readonly seo: {
    readonly title: string;
    readonly description: string;
  };
  readonly tagline: string;
  readonly sections: {
    readonly objects: HomeSection;
    readonly systems: HomeSection;
    readonly texts: HomeSection;
    readonly about: HomeSection;
  };
}

export const HOME_DOCUMENT: HomeDocument = {
  seo: {
    title: "somewhatintelligent — objects, systems, texts",
    description: "Objects, systems, texts, and other side effects by Apostoli.",
  },
  tagline: "objects, texts, systems, & side effects",
  sections: {
    objects: {
      eyebrow: "OBJECTS",
      body: "What better way to express your subversion than through consumption?",
      actionLabel: "Shop now",
    },
    systems: {
      eyebrow: "SYSTEMS",
      body: "People used to live in longhouses. Now you want an MCP gateway.",
      actionLabel: "Explore systems",
    },
    texts: {
      eyebrow: "TEXTS",
      body: "Critical writing. Or a catalog of my arrogance. Interpretation is left as an exercise to the reader.",
      actionLabel: "Read texts",
    },
    about: {
      eyebrow: "ABOUT",
      body: "The mask behind the other, more abstract mask. Of course, the subject remains as obscured as ever.",
      actionLabel: "About",
    },
  },
};
