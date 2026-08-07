/**
 * THE PRODUCT PAGE'S DECISIONS, made once and away from the markup.
 *
 * The page has exactly three branches worth getting right, and all three are
 * about ABSENCE rather than layout:
 *
 *   one image      no filmstrip, and the single plate fills the whole gallery
 *                  field — not a strip of one, and never an empty second cell.
 *   no details     no `Product details` accordion. Not an empty one.
 *   no size guide  no `Size & fit` accordion, and no sizing plate to swap to.
 *
 * Kept here rather than in the `.astro` frontmatter so they are testable
 * without a renderer, which is the same trade `core/cart.ts` makes. The
 * template is then the page's SHAPE and carries no conditions of its own.
 *
 * NOTHING HERE READS A ROLE. Presentation is position and only position: index
 * 0 is what the page opens on and what the shop's listing showed, and the
 * filmstrip numbers the rest from there. The DTO arrives already ordered — see
 * `Storefront.getActiveProductBySlug` — so this reindexes rather than sorts.
 */
/**
 * The DTO comes from the package rather than through `lib/commerce.ts`, which
 * only re-exports it. That module opens with `import { env } from
 * "cloudflare:workers"`, and this one has to be importable by `bun test` — a
 * type-only import is erased, but routing a `core/` module through a
 * binding-holding module is a dependency waiting to stop being type-only.
 */
import type { StorefrontProductDTO } from "platform.commerce/contracts";
import { paragraphs } from "./markdown.ts";

export interface ProductPlate {
  readonly href: string;
  readonly alt: string;
  /** `01`, `02`, `03` — what the filmstrip prints and what a control is labelled by. */
  readonly label: string;
}

export interface ProductPanel {
  /** Stable, so the `<details>`, its summary and its region can be wired together. */
  readonly id: "details" | "size-fit";
  readonly label: string;
  readonly paragraphs: readonly string[];
}

export interface SizingPlate {
  readonly href: string;
  readonly alt: string;
}

export interface ProductView {
  /** `OBJECT / field-tee / 1.2.0` — the honest handle, which is the URL plus what shipped. */
  readonly identifier: string;
  /** Always rendered, directly under the title. Empty when the operator wrote none. */
  readonly description: readonly string[];
  /**
   * ORDERED, and the order is the whole model: index 0 is the listing cover and
   * the shot the page opens on. `showFilmstrip` and `cover` were once fields
   * here; both are one expression over this array, and carrying them meant
   * threading a derived value through an interface, a component prop and a call
   * site so a consumer that already held `media` could be told what it could
   * see.
   */
  readonly media: readonly ProductPlate[];
  /** Zero, one or two. Only one may be open at a time — see `ProductPanels.astro`. */
  readonly panels: readonly ProductPanel[];
  /** The chart the gallery swaps to while `Size & fit` is open. */
  readonly sizingPlate: SizingPlate | null;
}

const pad = (index: number): string => String(index + 1).padStart(2, "0");

export const productView = (product: StorefrontProductDTO): ProductView => {
  /**
   * The alt falls back to the title HERE rather than in three `||`s down the
   * page. An operator who left one blank still gets a name for the image
   * instead of an unlabelled control in the filmstrip.
   */
  const media = product.media.map(
    (image, index): ProductPlate => ({
      href: image.href,
      alt: image.alt || `${product.title}, image ${pad(index)}`,
      label: pad(index),
    }),
  );

  const details = paragraphs(product.detailsMarkdown);
  const fitComments = paragraphs(product.sizeGuide?.notesMarkdown);

  /**
   * BUILT BY PUSHING, so an absent field contributes no entry at all. A list
   * of two with `hidden` flags is how empty accordions get shipped — the panel
   * either exists or it does not, and the markup maps whatever is here.
   *
   * The size-guide panel turns on the ASSET, never on the comments: comments
   * with no chart to caption are leftovers from a removed panel, and comments
   * are optional beside a chart that exists.
   */
  const panels: ProductPanel[] = [];
  if (details.length > 0) {
    panels.push({ id: "details", label: "Product details", paragraphs: details });
  }
  if (product.sizeGuide) {
    /**
     * The comments are OPTIONAL beside a chart that exists, so an empty body is
     * reachable here and only here — and a drawer that opens onto nothing is
     * worse than the sentence saying where the chart went. Resolved here rather
     * than as a branch in the template, so the markup maps `paragraphs`
     * unconditionally and no renderer has to know which panel it is holding.
     */
    const body = fitComments.length > 0 ? fitComments : ["Measurements are shown on the left."];
    panels.push({ id: "size-fit", label: "Size & fit", paragraphs: body });
  }

  return {
    identifier: `Object / ${product.slug} / ${product.version}`,
    description: paragraphs(product.descriptionMarkdown),
    media,
    panels,
    sizingPlate: product.sizeGuide
      ? { href: product.sizeGuide.href, alt: product.sizeGuide.alt }
      : null,
  };
};

/**
 * The two sentences that depend on what is buyable, settled here for the same
 * reason as everything above.
 *
 * "No sizes published" and "Sold out" are DIFFERENT facts: the first is an
 * operator who has not finished, the second is a run that is spoken for.
 */
export const availabilityLine = (variants: StorefrontProductDTO["variants"]): string => {
  if (variants.length === 0) return "No sizes published.";
  return variants.some((variant) => variant.available) ? "Select a size." : "Sold out.";
};
