/**
 * THE MARKDOWN TWIN OF EVERY PAGE THAT HAS ONE.
 *
 * The llms.txt convention is that `<url>.md` returns the same page as clean
 * markdown. It is worth serving for a plain reason that has nothing to do with
 * ranking: an agent fetching `/shop/field-tee` gets a Worker-rendered document
 * of nav chrome, an accordion, a filmstrip and an inline `<script>` — and has to
 * infer the price out of it. The same page as forty lines of markdown is the
 * same facts without the guessing.
 *
 * WHICH PAGES HAVE ONE, AND WHICH DELIBERATELY DO NOT. Every page whose content
 * is already DATA gets a twin: the four committed documents, and the products,
 * which come from commerce. The four policy pages do NOT — their prose lives in
 * `.astro` markup, so a twin would mean a second copy of a refund policy, and a
 * refunds page that disagrees with itself is a worse outcome than an agent
 * reading the HTML. They are linked from `llms.txt` as HTML instead. Moving that
 * prose into documents the way `about-document.ts` already does is what would
 * unblock them.
 *
 * Pure — the endpoint that serves these holds the commerce binding, and this
 * only takes what it returned.
 */
/**
 * The DTOs come FROM the contracts package rather than being restated here —
 * the same trade `core/product-view.ts` makes, and for the same reason: a
 * type-only import is erased, so a pure `core/` module can name the wire shape
 * without reaching the binding-holding `lib/commerce.ts`. `Pick` says which
 * fields this module reads without a hand-written twin to keep in step.
 */
import type { ProductCardDTO, StorefrontProductDTO } from "platform.commerce/contracts";

import { brand } from "platform.design/logo";

import { formatDate, formatPrice } from "../lib/format.ts";
import { paragraphs } from "./markdown.ts";
import { absoluteUrl } from "./site.ts";

/** What every twin opens with, so a fetched fragment still says where it is from. */
const header = (origin: string, path: string, title: string, description: string): string[] => [
  `# ${title}`,
  "",
  `> ${description}`,
  "",
  `Source: ${absoluteUrl(origin, path)}`,
  "",
];

export interface HomeInput {
  readonly seo: { readonly title: string; readonly description: string };
  readonly tagline: string;
  readonly sections: Readonly<Record<string, { readonly eyebrow: string; readonly body: string }>>;
}

export const homeMarkdown = (origin: string, doc: HomeInput): string =>
  [
    ...header(origin, "/", brand.wordmarkFull, doc.seo.description),
    `_${doc.tagline}_`,
    "",
    ...Object.values(doc.sections).flatMap(({ eyebrow, body }) => [`## ${eyebrow}`, "", body, ""]),
  ].join("\n");

export interface AboutInput {
  readonly seo: { readonly title: string; readonly description: string };
  readonly title: string;
  readonly statement: string;
  readonly lowerContent: string | null;
}

export const aboutMarkdown = (origin: string, doc: AboutInput): string =>
  [
    ...header(origin, "/about", doc.title, doc.seo.description),
    doc.statement,
    "",
    ...(doc.lowerContent ? [doc.lowerContent, ""] : []),
  ].join("\n");

/** One ledger row: the fields a listing line prints, and no more. */
export type ListedProduct = Pick<
  ProductCardDTO,
  "slug" | "title" | "priceCents" | "currency" | "descriptionMarkdown"
>;

export const shopMarkdown = (
  origin: string,
  doc: { readonly seo: { readonly title: string; readonly description: string } },
  products: readonly ListedProduct[],
  reachable: boolean,
): string =>
  [
    ...header(origin, "/shop", "Objects", doc.seo.description),
    ...(reachable
      ? products.length > 0
        ? products.map((product) => {
            const [summary] = paragraphs(product.descriptionMarkdown);
            const price = formatPrice(product.priceCents, product.currency);
            const link = `[${product.title}](${absoluteUrl(origin, `/shop/${product.slug}.md`)})`;
            return `- ${link} — ${price}${summary ? `: ${summary}` : ""}`;
          })
        : ["No objects are published yet."]
      : /**
         * SAID, NOT OMITTED. An empty list and an unreachable catalogue render
         * identically to anything that only counts rows — and the whole reason
         * the HTML page distinguishes them is that an outage reported as "no
         * stock" is the outage nobody finds out about.
         */
        ["_The catalogue is unreachable right now; this list is incomplete._"]),
    "",
  ].join("\n");

/** Everything a twin prints about one object — which is most of the DTO. */
export type ProductInput = Pick<
  StorefrontProductDTO,
  | "slug"
  | "title"
  | "version"
  | "priceCents"
  | "currency"
  | "descriptionMarkdown"
  | "detailsMarkdown"
  | "sizeGuide"
  | "media"
  | "variants"
>;

/**
 * ONE OBJECT, AS FACTS. Price, release, what is in stock in which size, what
 * the operator wrote, and where the photographs are — in that order, because
 * that is the order the questions get asked in.
 *
 * The prices are the market the caller read the product in. The twin does not
 * restate which market that was; the endpoint reads the same cookie the HTML
 * page does, so the two agree by construction.
 */
export const productMarkdown = (origin: string, product: ProductInput): string => {
  const description = paragraphs(product.descriptionMarkdown);
  const details = paragraphs(product.detailsMarkdown);
  const fit = paragraphs(product.sizeGuide?.notesMarkdown);

  const sizes = product.variants.map(
    (variant) => `- ${variant.size} — ${variant.available ? "in stock" : "sold out"}`,
  );

  return [
    ...header(
      origin,
      `/shop/${product.slug}`,
      product.title,
      description[0] ?? `${product.title} — object by somewhatintelligent.`,
    ),
    `- **Price:** ${formatPrice(product.priceCents, product.currency)}`,
    `- **Release:** ${product.version}`,
    `- **Buy:** ${absoluteUrl(origin, `/shop/${product.slug}`)}`,
    "",
    ...(description.length > 0 ? [...description, ""] : []),
    "## Sizes",
    "",
    ...(sizes.length > 0 ? sizes : ["No sizes published."]),
    "",
    ...(details.length > 0 ? ["## Product details", "", ...details, ""] : []),
    ...(product.sizeGuide
      ? ["## Size & fit", "", product.sizeGuide.alt, "", ...fit, ...(fit.length > 0 ? [""] : [])]
      : []),
    ...(product.media.length > 0
      ? [
          "## Images",
          "",
          ...product.media.map((image) => `- ![${image.alt}](${absoluteUrl(origin, image.href)})`),
          "",
        ]
      : []),
  ].join("\n");
};

/** An index with nothing in it yet — and the twin says so rather than being absent. */
export const placeholderMarkdown = (
  origin: string,
  path: string,
  title: string,
  description: string,
  note: string,
): string => [...header(origin, path, title, description), note, ""].join("\n");

/** One row of the writing index, as the twin needs it. */
export interface ListedText {
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly deck: string;
  readonly publishedAt: number;
  readonly readingMinutes: number;
}

/**
 * The writing index as markdown.
 *
 * LINKS POINT AT THE HTML PAGE, not at a `.md` twin — unlike the shop, which
 * links object to object. There is no `/writing/<slug>.md` route yet, and a
 * twin that advertises addresses which 404 is worse than one that sends an
 * agent to the page that exists. The texts are markdown in the repository, so
 * per-text twins are nearly free; this line is what changes when they land.
 */
export const writingMarkdown = (
  origin: string,
  heading: string,
  description: string,
  texts: readonly ListedText[],
  emptyMessage: string,
): string =>
  [
    ...header(origin, "/writing", heading, description),
    ...(texts.length > 0
      ? texts.map((text) => {
          const link = `[${text.title}](${absoluteUrl(origin, `/writing/${text.slug}`)})`;
          const meta = `${formatDate(text.publishedAt)}, ${text.kind}, ${text.readingMinutes} min`;
          return `- ${link} — ${meta}: ${text.deck}`;
        })
      : [emptyMessage]),
    "",
  ].join("\n");
