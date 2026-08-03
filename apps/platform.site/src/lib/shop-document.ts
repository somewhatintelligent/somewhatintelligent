/**
 * The shop index's copy.
 *
 * Same arrangement as `writing-document.ts`: in the site this replaces, `/shop`
 * read this from the Publisher service and fell back to a site-local default
 * when the page had never been published. The scaffold keeps ONLY the fallback,
 * so the read can be reintroduced later as the thing that overrides it.
 *
 * The LEDGER ROWS were never document content, and they are not here — they
 * come from commerce over the binding. See `./commerce.ts`.
 */

export interface ShopDocument {
  readonly seo: {
    readonly title: string;
    readonly description: string;
  };
  /** The accessible title behind the drawn OBJECTS plane. */
  readonly title: string;
  readonly deck: string;
  /** Shown when the catalogue has nothing active to sell. */
  readonly emptyMessage: string;
  /**
   * Shown when the catalogue could not be READ, and a different sentence
   * because it is a different fact. "Nothing is published yet" and "the shop is
   * broken" must not render identically, or an outage looks like an empty store
   * and nobody finds out.
   */
  readonly unavailableMessage: string;
}

export const SHOP_DOCUMENT: ShopDocument = {
  seo: {
    title: "Objects — somewhatintelligent",
    description: "Versioned clothing and physical goods published by somewhatintelligent.",
  },
  title: "OBJECTS",
  deck: "Artifacts for interface, code, and the public we build.",
  emptyMessage: "No objects are published yet.",
  unavailableMessage: "The catalogue is unreachable right now. Try again shortly.",
};
