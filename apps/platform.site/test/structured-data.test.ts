/**
 * THE JSON-LD, WHICH IS THE ONE PART OF A PAGE NOBODY LOOKS AT.
 *
 * A broken paragraph gets reported by the first person who reads it. A broken
 * `Offer` is invisible until a merchant listing quietly stops appearing, months
 * later, with nothing in the page to point at. So the assertions here are about
 * the things Google actually rejects on — a variant with no unique id, a
 * currency in the wrong case, an availability that is a word instead of an IRI —
 * rather than about the shape of the object being what it was when it was
 * written.
 *
 * WHAT IS DELIBERATELY NOT TESTED: that the brand name is "somewhatintelligent",
 * that a policy is 30 days. Those restate a constant from the module under test.
 * `policy.test.ts` does not exist for the same reason.
 */
import { describe, expect, test } from "bun:test";
import type { StorefrontProductDTO } from "platform.commerce/contracts";

import {
  availabilityIri,
  breadcrumbs,
  graph,
  isoCurrency,
  itemList,
  majorUnits,
  organization,
  productNode,
  serialize,
  webSite,
} from "../src/core/structured-data.ts";

const ORIGIN = "https://somewhatintelligent.ca";

const product = (overrides: Partial<StorefrontProductDTO> = {}): StorefrontProductDTO => ({
  slug: "friend-001",
  title: "I think we should be friends",
  descriptionMarkdown: "I mean in the C++ way.",
  detailsMarkdown: null,
  sizeGuide: null,
  priceCents: 6_969,
  currency: "cad",
  version: "1.0.0",
  media: [{ href: "/media/a", alt: "front" }],
  variants: [
    { id: "v-s", size: "S", available: true },
    { id: "v-m", size: "M", available: false },
  ],
  ...overrides,
});

const node = (overrides: Partial<StorefrontProductDTO> = {}) =>
  productNode({
    origin: ORIGIN,
    product: product(overrides),
    market: "CA",
    description: "I mean in the C++ way.",
  }) as Record<string, any>;

describe("money", () => {
  test("minor units become major without the float tail a bare divide leaves", () => {
    expect(majorUnits(6_969)).toBe(69.69);
    expect(majorUnits(1_010)).toBe(10.1);
    expect(majorUnits(0)).toBe(0);
  });

  /** The DTO carries Stripe's lowercase spelling; ISO 4217 and Google want upper. */
  test("currency is uppercased", () => {
    expect(isoCurrency("cad")).toBe("CAD");
    expect(isoCurrency("USD")).toBe("USD");
  });
});

describe("availability", () => {
  /** Google matches the full IRI. `"InStock"` on its own is silently ignored. */
  test("is an IRI, not a word", () => {
    expect(availabilityIri(true)).toBe("https://schema.org/InStock");
    expect(availabilityIri(false)).toBe("https://schema.org/OutOfStock");
  });
});

describe("productNode", () => {
  test("a product with sizes is a ProductGroup that varies by size", () => {
    const group = node();
    expect(group["@type"]).toBe("ProductGroup");
    expect(group.variesBy).toEqual(["https://schema.org/size"]);
    expect(group.productGroupID).toBe("friend-001");
  });

  /**
   * THE REQUIREMENT GOOGLE IS STRICTEST ABOUT: every variant needs an id that
   * tells it apart from its siblings, or the whole group is dropped.
   */
  test("every variant carries a unique sku", () => {
    const skus = node().hasVariant.map((variant: any) => variant.sku);
    expect(skus).toEqual(["v-s", "v-m"]);
    expect(new Set(skus).size).toBe(skus.length);
  });

  test("each variant's availability is its own, not the group's", () => {
    const [small, medium] = node().hasVariant;
    expect(small.offers.availability).toBe("https://schema.org/InStock");
    expect(medium.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  test("a variant's name is specific where the group's is general", () => {
    const group = node();
    expect(group.name).toBe("I think we should be friends");
    expect(group.hasVariant[0].name).toBe("I think we should be friends — S");
  });

  /**
   * A group that varies in no way is a lie about the data. A product with no
   * published sizes is not buyable, and the markup has to say that rather than
   * describe an empty set of variants.
   */
  test("a product with no published sizes is a plain, out-of-stock Product", () => {
    const lone = node({ variants: [] });
    expect(lone["@type"]).toBe("Product");
    expect(lone.hasVariant).toBeUndefined();
    expect(lone.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  test("images and offer urls are absolute — a crawler resolves neither relative form", () => {
    const group = node();
    expect(group.image).toEqual([`${ORIGIN}/media/a`]);
    expect(group.hasVariant[0].offers.url).toBe(`${ORIGIN}/shop/friend-001`);
  });

  test("the offer carries the shipping and return facts a merchant listing needs", () => {
    const { offers } = node().hasVariant[0];
    expect(offers.priceCurrency).toBe("CAD");
    expect(offers.price).toBe(69.69);
    expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(offers.shippingDetails.shippingRate.value).toBe(0);
    expect(offers.shippingDetails.shippingDestination.addressCountry).toBe("CA");
    expect(offers.hasMerchantReturnPolicy.merchantReturnDays).toBe(30);
  });

  /** The US window is not the Canadian one — `/shipping` quotes them separately. */
  test("the transit window follows the market the page was priced in", () => {
    const ca = node().hasVariant[0].offers.shippingDetails.deliveryTime.transitTime;
    const us = (
      productNode({
        origin: ORIGIN,
        product: product(),
        market: "US",
        description: "",
      }) as any
    ).hasVariant[0].offers.shippingDetails.deliveryTime.transitTime;
    expect(ca.minValue).toBe(3);
    expect(us.minValue).toBe(5);
  });

  /**
   * INVENTING RATINGS IS THE ONE STRUCTURED-DATA OFFENCE GOOGLE ISSUES MANUAL
   * ACTIONS FOR. There are no reviews; there must be no `aggregateRating`.
   */
  test("claims no ratings and no reviews", () => {
    const group = node();
    expect(group.aggregateRating).toBeUndefined();
    expect(group.review).toBeUndefined();
  });

  /**
   * `version` is defined on `CreativeWork` and not on `Product`. The release has
   * to travel as an `additionalProperty` or it is a property out of vocabulary.
   */
  test("the release rides as an additionalProperty, not as `version`", () => {
    const group = node();
    expect(group.version).toBeUndefined();
    expect(group.additionalProperty).toEqual({
      "@type": "PropertyValue",
      name: "Release",
      value: "1.0.0",
    });
  });
});

describe("breadcrumbs", () => {
  test("positions start at 1 and the last crumb carries no item", () => {
    const trail = breadcrumbs(ORIGIN, [
      { name: "somewhatintelligent", path: "/" },
      { name: "Objects", path: "/shop" },
      { name: "Field tee" },
    ]) as any;

    expect(trail.itemListElement.map((item: any) => item.position)).toEqual([1, 2, 3]);
    expect(trail.itemListElement[0].item).toBe(`${ORIGIN}/`);
    expect(trail.itemListElement[2].item).toBeUndefined();
  });

  /** A path on the final crumb is dropped rather than emitted — Google infers the page. */
  test("a path on the final crumb is ignored", () => {
    const trail = breadcrumbs(ORIGIN, [
      { name: "Home", path: "/" },
      { name: "Objects", path: "/shop" },
    ]) as any;
    expect(trail.itemListElement[1].item).toBeUndefined();
  });
});

describe("graph", () => {
  test("nodes reference the organization rather than restating it", () => {
    const document = graph([organization(ORIGIN), webSite(ORIGIN)]) as any;
    const [org, site] = document["@graph"];
    expect(site.publisher).toEqual({ "@id": org["@id"] });
    expect(document["@context"]).toBe("https://schema.org");
  });

  test("the product's brand is the same entity the page already described", () => {
    const org = organization(ORIGIN) as any;
    expect(node().brand).toEqual({ "@id": org["@id"] });
  });
});

describe("itemList", () => {
  test("the index lists addresses, not products", () => {
    const list = itemList(ORIGIN, [{ slug: "a" }, { slug: "b" }]) as any;
    expect(list.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, url: `${ORIGIN}/shop/a` },
      { "@type": "ListItem", position: 2, url: `${ORIGIN}/shop/b` },
    ]);
  });
});

describe("serialize", () => {
  /**
   * THE ONE INJECTION SURFACE HERE. `</script>` inside a JSON string ends the
   * block wherever it appears, and everything after it is parsed as markup — so
   * an operator's description is enough to take a page apart. Astro's `set:html`
   * escapes nothing, which is why this is done rather than assumed.
   */
  test("closes no script tag an operator typed into a description", () => {
    const output = serialize({ description: "</script><img src=x onerror=alert(1)>" });
    expect(output).not.toContain("</script>");
    expect(output).toContain("\\u003c/script");
    expect(JSON.parse(output).description).toBe("</script><img src=x onerror=alert(1)>");
  });
});
