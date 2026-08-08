/**
 * `/llms.txt` — the site's index for whatever is reading it that is not a
 * browser.
 *
 * WHAT IT IS AND IS NOT WORTH. It does nothing for Google Search; Google has
 * said so plainly, and the crawl volume the format actually receives is small.
 * It is served here for the narrower thing it demonstrably is: Anthropic
 * recommends it and Claude honours it in retrieval, and it is the one file that
 * tells an agent, in one fetch, that every page has a markdown twin and where
 * the objects live. That is worth ~60 lines and no maintenance — it is composed
 * from the same documents the pages render.
 *
 * THE FORMAT IS THE SPEC'S, exactly: an H1 (the only required section), a
 * blockquote summary, free prose, then H2 sections of markdown link lists with
 * an optional `: note` after each link. `## Optional` is a reserved heading —
 * it marks the links an agent may skip when it needs a shorter context, which
 * is the right home for four policy pages.
 */
import { brand } from "platform.design/logo";

import { formatPrice } from "../lib/format.ts";
import { paragraphs } from "./markdown.ts";
import type { ListedProduct } from "./page-markdown.ts";
import { RETURN_WINDOW_DAYS, TRANSIT_DAYS } from "./policy.ts";
import { absoluteUrl } from "./site.ts";

/**
 * The same row `shopMarkdown` prints, because it is the same row — the two
 * differ only in punctuation, and a second interface listing the same five
 * fields was a shape a reader had to compare character by character to confirm
 * was identical.
 */
export type LlmsProduct = ListedProduct;

const link = (origin: string, path: string, name: string, note?: string): string =>
  `- [${name}](${absoluteUrl(origin, path)})${note ? `: ${note}` : ""}`;

export const llmsTxt = ({
  origin,
  products,
  reachable,
}: {
  readonly origin: string;
  readonly products: readonly LlmsProduct[];
  /** False when the catalogue read failed — the objects section says so rather than reading empty. */
  readonly reachable: boolean;
}): string =>
  [
    `# ${brand.wordmarkFull}`,
    "",
    "> Objects, systems, texts, and other side effects by Apostoli — a one-person",
    "> studio publishing versioned clothing, software and critical writing.",
    "",
    "Every page listed here has a markdown twin at the same URL with `.md`",
    "appended, and the links below point at those rather than at the HTML.",
    "",
    "Objects are sold in two markets, Canada and the United States. Prices below",
    "are the Canadian ones; a request carrying the `si_market=US` cookie is",
    "answered in USD throughout. Shipping is included in every price, and US",
    "duties are prepaid — see the policy pages under Optional.",
    "",
    "## Objects",
    "",
    ...(reachable
      ? products.length > 0
        ? products.map((product) => {
            const [summary] = paragraphs(product.descriptionMarkdown);
            const price = formatPrice(product.priceCents, product.currency);
            return link(
              origin,
              `/shop/${product.slug}.md`,
              product.title,
              summary ? `${price} — ${summary}` : price,
            );
          })
        : ["No objects are published yet."]
      : ["_The catalogue could not be read; this section is incomplete._"]),
    "",
    "## Pages",
    "",
    link(origin, "/index.md", "Home", "the studio, in four records"),
    link(origin, "/shop.md", "Objects", "everything published and for sale"),
    link(origin, "/writing.md", "Texts", "essays, papers and notes"),
    link(origin, "/software.md", "Software", "systems and tools"),
    link(origin, "/about.md", "About", "who publishes this"),
    "",
    "## Optional",
    "",
    /**
     * HTML, NOT `.md`. These four have no markdown twin on purpose — their prose
     * lives in the page markup, and a second copy of a refund policy is a
     * liability rather than a convenience. See `core/page-markdown.ts`.
     *
     * The windows in the notes are INTERPOLATED rather than retyped, for the
     * same reason one step further: `core/policy.ts` is already the
     * machine-readable mirror of those two pages for the schema.org offer, and
     * writing "CA 3–8" here as prose made it a THIRD copy — the one where a
     * changed transit time would go unnoticed longest.
     */
    link(
      origin,
      "/shipping",
      "Shipping",
      `free everywhere; CA ${TRANSIT_DAYS.CA.minDays}–${TRANSIT_DAYS.CA.maxDays} and ` +
        `US ${TRANSIT_DAYS.US.minDays}–${TRANSIT_DAYS.US.maxDays} business days`,
    ),
    link(
      origin,
      "/refunds",
      "Refunds",
      `${RETURN_WINDOW_DAYS} days; exchange on sizing, refund or replace on defects`,
    ),
    link(origin, "/terms", "Terms"),
    link(origin, "/privacy", "Privacy"),
    "",
  ].join("\n");
