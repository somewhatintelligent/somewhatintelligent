/**
 * The writing index's page copy — the masthead and the plate that shows when
 * the collection is empty.
 *
 * This used to carry the row types too, back when `/writing` read a keyset page
 * of published texts from the Publisher service and needed a shape to describe
 * what came over the binding. The texts are files in this repository now, so
 * the row type belongs with the logic that derives it (`core/writing-view.ts`)
 * and this is copy and nothing else.
 */

export interface WritingDocument {
  readonly seo: {
    readonly title: string;
    readonly description: string;
  };
  readonly heading: string;
  readonly emptyMessage: string;
}

export const WRITING_DOCUMENT: WritingDocument = {
  seo: {
    title: "Writing — somewhatintelligent",
    description: "Writing by Apostoli, published by somewhatintelligent.",
  },
  heading: "Texts",
  emptyMessage: "No texts published yet.",
};
