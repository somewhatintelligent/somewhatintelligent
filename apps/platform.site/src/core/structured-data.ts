/**
 * THE MACHINE-READABLE COPY OF EVERY PAGE, built where it can be tested.
 *
 * Pure functions over data the pages already hold, for the same reason
 * `core/product-view.ts` is pure: a `<script type="application/ld+json">` is
 * the one part of a page nobody looks at, so the only way it stays right is if
 * a test reads it. Nothing here touches a binding, a cookie or `Astro`.
 *
 * ONE `@graph` PER PAGE, NOT SEVERAL BLOCKS. Every node carries an `@id`, so
 * the product on `/shop/x` and the organization in the footer are the SAME
 * entities a crawler has already seen on `/` rather than near-duplicates it has
 * to reconcile. It also means `brand` is a reference instead of a fourth copy
 * of the studio's name.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *
 *   `aggregateRating` / `review`  — there are no reviews. Inventing them is the
 *                                   one structured-data offence Google issues
 *                                   manual actions for.
 *   `priceValidUntil`             — recommended, but a date in the past makes
 *                                   Google drop the price entirely, and nothing
 *                                   here knows when a price expires. Absent
 *                                   beats stale.
 *   `gtin` / `mpn`                — these objects have neither. A made-up
 *                                   identifier is worse than none.
 */
import type { StorefrontProductDTO } from "platform.commerce/contracts";
import { brand } from "platform.design/logo";
import { SOCIAL_PROFILES, SUPPORT_EMAIL } from "platform.names";

import type { MarketCode } from "./market.ts";
import {
  HANDLING_DAYS,
  RETURN_WINDOW_DAYS,
  SHIPPING_RATE_MINOR_UNITS,
  TRANSIT_DAYS,
} from "./policy.ts";
import { absoluteUrl } from "./site.ts";

export type JsonLdNode = Record<string, unknown>;

/** Schema.org enumeration members are IRIs, not bare words. Google matches on the full URL. */
const SCHEMA = "https://schema.org";

/**
 * THE WORDMARK, READ RATHER THAN RETYPED. It is the same string the cards draw
 * and the header prints, and `platform.design/logo` is the file a reskin edits.
 * A JSON-LD copy is the one nobody looks at, so it is the copy that would have
 * outlived a rename.
 */
export const BRAND_NAME = brand.wordmarkFull;

/** Stable `@id`s, so every page refers to one organization rather than describing many. */
const organizationId = (origin: string): string => `${origin}/#organization`;
const webSiteId = (origin: string): string => `${origin}/#website`;
const productId = (origin: string, slug: string): string =>
  `${absoluteUrl(origin, `/shop/${slug}`)}#product`;

/** Wraps nodes into the single document a page embeds. */
export const graph = (nodes: readonly JsonLdNode[]): JsonLdNode => ({
  "@context": SCHEMA,
  "@graph": nodes,
});

/**
 * THE PUBLISHER. Present on every page, because `brand`, `publisher` and
 * `seller` all point at it and a dangling `@id` reference is worth less than no
 * reference at all.
 *
 * `Organization` rather than `Person` even though one person is behind it: the
 * entity that sells the objects and issues the refunds is the studio, and
 * Google's merchant surfaces read `Organization`.
 */
export const organization = (origin: string): JsonLdNode => ({
  "@type": "Organization",
  "@id": organizationId(origin),
  name: BRAND_NAME,
  url: `${origin}/`,
  logo: {
    "@type": "ImageObject",
    url: absoluteUrl(origin, "/og/icon-512.png"),
    width: 512,
    height: 512,
  },
  image: absoluteUrl(origin, "/og/opengraph-image.png"),
  email: SUPPORT_EMAIL,
  /**
   * The same list `SiteFooter` renders as `rel="me"` links — one claim, made in
   * two vocabularies, from one source. Made twice from two sources is how the
   * JSON-LD ends up asserting a profile the footer no longer links.
   */
  sameAs: SOCIAL_PROFILES.map((profile) => profile.url),
});

/**
 * THE SITE, and the reason it is home-only: Google reads `WebSite` for the site
 * name shown above a result, and its documentation is explicit that the markup
 * must sit on the domain root. Repeating it on every page does not strengthen
 * the signal; it just gives a crawler more copies to pick between.
 *
 * No `potentialAction`/`SearchAction` — Google retired the sitelinks search box,
 * and this site has no search endpoint to point one at regardless.
 */
export const webSite = (origin: string): JsonLdNode => ({
  "@type": "WebSite",
  "@id": webSiteId(origin),
  name: BRAND_NAME,
  url: `${origin}/`,
  publisher: { "@id": organizationId(origin) },
  inLanguage: "en",
});

export interface Crumb {
  readonly name: string;
  /** Root-relative. Omitted on the final crumb — Google infers the current URL. */
  readonly path?: string;
}

/**
 * `position` starts at 1 and the LAST crumb carries no `item`, which is what
 * Google's spec asks for: the trailing entry is the page you are on, and giving
 * it a URL invites a mismatch with the canonical.
 */
export const breadcrumbs = (origin: string, trail: readonly Crumb[]): JsonLdNode => ({
  "@type": "BreadcrumbList",
  itemListElement: trail.map((crumb, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: crumb.name,
    ...(crumb.path && index < trail.length - 1 ? { item: absoluteUrl(origin, crumb.path) } : {}),
  })),
});

/** ISO 4217 is uppercase; the commerce DTO carries Stripe's lowercase spelling. */
export const isoCurrency = (currency: string): string => currency.toUpperCase();

/** Minor units to major, without the float artefacts a bare division leaves. */
export const majorUnits = (minorUnits: number): number => Number((minorUnits / 100).toFixed(2));

/**
 * FREE SHIPPING, STATED RATHER THAN OMITTED. Google renders a known-zero
 * delivery cost in the listing and treats a missing one as unknown, so the
 * cheapest true fact about this shop is also the one worth the most.
 *
 * The window is the buyer's market's, not both — a page is priced in one market
 * and quotes that market's transit times on `/shipping`.
 */
export const shippingDetails = (market: MarketCode, currency: string): JsonLdNode => {
  const transit = TRANSIT_DAYS[market];
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: majorUnits(SHIPPING_RATE_MINOR_UNITS),
      currency: isoCurrency(currency),
    },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: market },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: HANDLING_DAYS.minDays,
        maxValue: HANDLING_DAYS.maxDays,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: transit.minDays,
        maxValue: transit.maxDays,
        unitCode: "DAY",
      },
    },
  };
};

/**
 * THE STRICTER HALF OF `/refunds`, and see `core/policy.ts` for why.
 *
 * `ReturnShippingFees` says the buyer pays return postage, which is true of the
 * sizing exchange and untrue of a defect — where the item is not returned at
 * all. One policy per offer means encoding the case a buyer is more likely to
 * be disappointed by.
 */
export const returnPolicy = (market: MarketCode): JsonLdNode => ({
  "@type": "MerchantReturnPolicy",
  applicableCountry: market,
  returnPolicyCategory: `${SCHEMA}/MerchantReturnFiniteReturnWindow`,
  merchantReturnDays: RETURN_WINDOW_DAYS,
  returnMethod: `${SCHEMA}/ReturnByMail`,
  returnFees: `${SCHEMA}/ReturnShippingFees`,
});

export const availabilityIri = (available: boolean): string =>
  available ? `${SCHEMA}/InStock` : `${SCHEMA}/OutOfStock`;

interface OfferInput {
  readonly origin: string;
  readonly url: string;
  readonly priceCents: number;
  readonly currency: string;
  /**
   * The two policy nodes, built ONCE per page and shared by every variant's
   * offer. They are the same five and six fields whatever size is being
   * described, and rebuilding them per variant meant ~50 redundant objects on a
   * five-size product. `JSON.stringify` expands the shared reference back out,
   * so the wire form is unchanged — the duplication there is schema.org's, not
   * ours to remove.
   */
  readonly shipping: JsonLdNode;
  readonly returns: JsonLdNode;
  readonly available: boolean;
}

const offer = ({
  origin,
  url,
  priceCents,
  currency,
  shipping,
  returns,
  available,
}: OfferInput): JsonLdNode => ({
  "@type": "Offer",
  url,
  price: majorUnits(priceCents),
  priceCurrency: isoCurrency(currency),
  availability: availabilityIri(available),
  itemCondition: `${SCHEMA}/NewCondition`,
  seller: { "@id": organizationId(origin) },
  shippingDetails: shipping,
  hasMerchantReturnPolicy: returns,
});

/**
 * The subset of a storefront product this module reads, named against the wire
 * contract rather than restated — `core/product-view.ts` makes the same trade,
 * and `platform.commerce/domain/Contracts.ts` calls hand-written DTO twins the
 * mistake it exists to fix. A type-only import is erased, so a pure module can
 * name the shape without reaching the binding.
 */
export type ProductInput = Pick<
  StorefrontProductDTO,
  "slug" | "title" | "priceCents" | "currency" | "version" | "media" | "variants"
>;

/**
 * ONE OBJECT, IN EVERY SIZE IT IS PUBLISHED IN.
 *
 * A `ProductGroup` with nested `hasVariant`, which is the shape Google
 * documents for a SINGLE-PAGE site — every size lives at one URL here, chosen
 * client-side, so there is no per-variant address to point at. `variesBy` says
 * size and nothing else, because that is the only axis these objects vary on
 * and Google accepts only its six enumerated properties.
 *
 * EVERY VARIANT CARRIES A UNIQUE `sku`. Google requires it to tell variants
 * apart, and the variant id already is one — stable, published, and the same
 * handle the cart and checkout use.
 *
 * A PRODUCT WITH NO PUBLISHED SIZES IS NOT A GROUP. It is one unbuyable
 * `Product`, marked out of stock: a `ProductGroup` with an empty `hasVariant`
 * describes a thing that varies in no way, which is a lie about the data rather
 * than a simplification of it.
 */
export const productNode = ({
  origin,
  product,
  market,
  description,
}: {
  readonly origin: string;
  readonly product: ProductInput;
  readonly market: MarketCode;
  readonly description: string;
}): JsonLdNode => {
  const { slug, title, priceCents, currency, version, media, variants } = product;
  const url = absoluteUrl(origin, `/shop/${slug}`);
  const images = media.map((image) => absoluteUrl(origin, image.href));

  /** Constant across every variant on this page — see `OfferInput`. */
  const shipping = shippingDetails(market, currency);
  const returns = returnPolicy(market);
  const offerFor = (available: boolean) =>
    offer({ origin, url, priceCents, currency, shipping, returns, available });

  const shared: JsonLdNode = {
    "@id": productId(origin, slug),
    name: title,
    url,
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    brand: { "@id": organizationId(origin) },
    /**
     * THE PUBLISHED RELEASE, and `additionalProperty` rather than `version`
     * because `version` is defined on `CreativeWork` and NOT on `Product` —
     * putting it here would be a property out of vocabulary that every
     * validator reports and no consumer reads. `PropertyValue` under
     * `additionalProperty` is the vocabulary's own answer for a fact a type has
     * no slot for, and it is what the page already prints under the title.
     */
    additionalProperty: {
      "@type": "PropertyValue",
      name: "Release",
      value: version,
    },
  };

  if (variants.length === 0) {
    return {
      "@type": "Product",
      ...shared,
      sku: slug,
      offers: offerFor(false),
    };
  }

  return {
    "@type": "ProductGroup",
    ...shared,
    productGroupID: slug,
    variesBy: [`${SCHEMA}/size`],
    hasVariant: variants.map((variant) => ({
      "@type": "Product",
      /** Specific where the group's name is general — Google asks for exactly this. */
      name: `${title} — ${variant.size}`,
      sku: variant.id,
      size: variant.size,
      ...(images[0] ? { image: images[0] } : {}),
      offers: offerFor(variant.available),
    })),
  };
};

/**
 * THE SHOP INDEX AS A LIST OF ADDRESSES, not a list of products.
 *
 * `ItemList` of URLs is the summary form Google documents for a category page:
 * the full `Product` markup belongs on the page that can actually be bought
 * from, and repeating it here would put two descriptions of the same object in
 * the index with only the listing's thinner one to reconcile against.
 */
export const itemList = (
  origin: string,
  products: readonly { readonly slug: string }[],
): JsonLdNode => ({
  "@type": "ItemList",
  itemListElement: products.map((product, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: absoluteUrl(origin, `/shop/${product.slug}`),
  })),
});

/**
 * The page itself — the node `breadcrumb` and `primaryImageOfPage` hang off, and
 * the one that tells a crawler this URL is part of the site described above.
 */
export const webPage = ({
  origin,
  path,
  name,
  description,
  type = "WebPage",
  image,
}: {
  readonly origin: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  /** `CollectionPage` for an index, `AboutPage` for `/about`, `ItemPage` for one object. */
  readonly type?: "WebPage" | "CollectionPage" | "AboutPage" | "ItemPage";
  readonly image?: string;
}): JsonLdNode => ({
  "@type": type,
  "@id": `${absoluteUrl(origin, path)}#webpage`,
  url: absoluteUrl(origin, path),
  name,
  description,
  isPartOf: { "@id": webSiteId(origin) },
  ...(image ? { primaryImageOfPage: image } : {}),
  inLanguage: "en",
});

/**
 * The graph a ONE-LEVEL page carries: the publisher, the page, and a two-crumb
 * trail back to the root.
 *
 * Every second-level route on this site has exactly that shape — `/about`,
 * `/software`, `/writing`, and the four policy pages differ only in their
 * strings. `/` and the shop pair carry extra nodes and build their graphs
 * explicitly, which is the honest split: this helper is for the pages that
 * genuinely have nothing more to say.
 */
export const pageGraph = ({
  origin,
  path,
  name,
  description,
  crumb,
  type = "WebPage",
}: {
  readonly origin: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  /** The page's own label in the trail. The root crumb is always the studio. */
  readonly crumb: string;
  readonly type?: "WebPage" | "CollectionPage" | "AboutPage" | "ItemPage";
}): JsonLdNode =>
  graph([
    organization(origin),
    webPage({ origin, path, name, description, type }),
    breadcrumbs(origin, [{ name: BRAND_NAME, path: "/" }, { name: crumb }]),
  ]);

/**
 * JSON-LD embedded in HTML, with the one escape that matters.
 *
 * `</script>` inside a JSON string ends the block early wherever it appears —
 * a product description containing it would break the page and hand the rest of
 * the document to the HTML parser as markup. Escaping the `<` is the standard
 * defence and costs one replace. Astro's `set:html` does no escaping of its own,
 * which is precisely why this is done here rather than assumed.
 */
export const serialize = (node: JsonLdNode): string =>
  JSON.stringify(node).replace(/</g, "\\u003c");
