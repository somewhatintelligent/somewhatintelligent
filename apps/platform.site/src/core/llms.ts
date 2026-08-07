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
import { formatPrice } from "../lib/format.ts";
import { paragraphs } from "./markdown.ts";
import { absoluteUrl } from "./site.ts";

export interface LlmsProduct {
  readonly slug: string;
  readonly title: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly descriptionMarkdown: string | null;
}

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
    "# somewhatintelligent",
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
    link(origin, "/writing.md", "Writing", "arguments, notes and revisions"),
    link(origin, "/software.md", "Software", "systems and tools"),
    link(origin, "/about.md", "About", "who publishes this"),
    "",
    "## Optional",
    "",
    /**
     * HTML, NOT `.md`. These four have no markdown twin on purpose — their prose
     * lives in the page markup, and a second copy of a refund policy is a
     * liability rather than a convenience. See `core/page-markdown.ts`.
     */
    link(origin, "/shipping", "Shipping", "free everywhere; CA 3–8 and US 5–12 business days"),
    link(
      origin,
      "/refunds",
      "Refunds",
      "30 days; exchange on sizing, refund or replace on defects",
    ),
    link(origin, "/terms", "Terms"),
    link(origin, "/privacy", "Privacy"),
    "",
  ].join("\n");
