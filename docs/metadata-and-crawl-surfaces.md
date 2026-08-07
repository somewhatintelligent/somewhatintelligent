# Metadata and crawl surfaces

What the platform publishes for readers that are not people: search engines,
social unfurlers, and agents. Two halves — **artwork**, built once and
committed, and **markup**, composed per request.

Nothing here is speculative SEO. Every choice below is tied to a documented
requirement of the consumer it is for, and the ones that are worth little are
marked as such rather than quietly included.

---

## 1. The card pipeline — `packages/platform.og`

JSX → satori → SVG → resvg → PNG, at build time. `platform-og build` discovers
`og/**/*.og.tsx` in the calling package and writes `public/og/*.png`.

```sh
cd apps/platform.site && bun run og    # or apps/platform.auth
```

**The output is committed.** A social crawler fetches a card once, cold, with a
short timeout and no cookies; a static file the CDN already holds is the
cheapest correct answer. The cost of committing build output is drift, so both
consumers carry a test (`test/og-cards.test.ts`) that re-renders every
definition and compares bytes — satori and resvg are deterministic, so a stale
PNG is a test failure rather than a surprise in someone's feed.

**It cannot run in a Worker.** `@resvg/resvg-js` is a native napi binding.
Request-time generation on Cloudflare needs `@resvg/resvg-wasm` (or `workers-og`
around it) — a different dependency, deliberately not smuggled in.

Two satori constraints that are not negotiable:

1. No CSS custom properties, no `@font-face`, no Tailwind. Cards carry literal
   hex from `platform.design/logo`'s `brand.ogSurfaces`, and fonts are handed
   over as file paths in each app's `og.config.ts`.
2. Every element with two or more children needs `display: flex`. satori lays
   out with yoga, which knows flex and nothing else.

### Where the brand lives

| File                                              | What                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| `packages/platform.design/src/logo/brand.ts`      | wordmark, mark geometry, `ogColors`, `ogSurfaces` |
| `packages/platform.design/src/logo/og-lockup.tsx` | the lockup both apps compose cards from           |
| `apps/*/og.config.ts`                             | the font files satori is handed                   |
| `apps/*/og/*.og.tsx`                              | one definition per output PNG                     |

A reskin edits the first two and reruns `bun run og` in each app. If a rebrand
diff touches an `og/*.og.tsx`, that is a bug.

### What each app emits

`icon` (96×96), `apple-icon` (180×180), `icon-512` (512×512),
`opengraph-image` and `twitter-image` (both 1200×630).

- **1200×630** renders uncropped on Facebook, X, LinkedIn, Slack, Discord,
  iMessage and WhatsApp. Below 600×315 Facebook degrades to the small card;
  below 200×200 it refuses the image.
- **96 for the favicon**, not 32: Google's favicon guidance asks for a multiple
  of 48px square, and browsers downscale better than they upscale.

---

## 2. Page markup — `apps/platform.site`

`src/layouts/Base.astro` is the single head. Every page gets canonical, robots,
Open Graph, Twitter, icons, manifest, and an optional JSON-LD graph.

### Absolute URLs, from the request

`src/core/site.ts` derives every absolute URL from `Astro.url.origin`, never
from a baked constant. The Worker answers on a workers.dev host in every stage
and on the apex only in production — a baked origin would make staging emit
canonicals pointing at production.

`canonicalPath` collapses trailing slashes, query and fragment. This matters
because `SiteHeader` links `/shop/` and `SiteFooter` links `/shipping`, and
Astro serves both spellings: without one rule the same page reached two ways
would carry two canonicals.

### Robots directives

`index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`.
The last three are opt-in — Google's default is a thumbnail and a truncated
snippet. `noindex, follow` on `/cart`, `/orders/<number>` and `/404`.

### Social cards per page

Pages whose subject is the studio get the generated card. **Product pages get
the object's own photograph** — a shared product link competes in a feed against
every other picture in it, and the shirt is a better picture of the shirt than a
title set over black. The bytes already exist behind an immutable cache header.
No `og:image:width`/`height` there: nothing has measured the upload, and
declared dimensions we have not read get the card letterboxed.

Product pages also carry the `product:` Open Graph namespace (price, currency,
availability). Facebook and Pinterest read those and neither reads JSON-LD.

---

## 3. Structured data — `src/core/structured-data.ts`

Pure functions, tested in `test/structured-data.test.ts`. One `@graph` per page
with stable `@id`s, so the organization on `/` and the `brand` on a product page
are the same entity rather than near-duplicates.

| Page       | Nodes                                                  |
| ---------- | ------------------------------------------------------ |
| `/`        | Organization, WebSite, WebPage                         |
| `/shop`    | Organization, CollectionPage, BreadcrumbList, ItemList |
| `/shop/:s` | Organization, ItemPage, BreadcrumbList, ProductGroup   |
| others     | Organization, WebPage, BreadcrumbList                  |

**`WebSite` is home-only** — Google's site-name documentation requires the
markup on the domain root.

**Products are a `ProductGroup` with nested `hasVariant`**, which is the shape
Google documents for a single-page site: every size lives at one URL here, so
there is no per-variant address to point at. `variesBy` is
`https://schema.org/size` — Google accepts only six enumerated properties there.
Every variant carries the variant id as `sku`, which Google requires to tell
variants apart. A product with no published sizes is a plain out-of-stock
`Product`, not a group that varies in no way.

**Offers carry `shippingDetails` and `hasMerchantReturnPolicy`.** The numbers
come from `src/core/policy.ts`, which is a **mirror of `/shipping` and
`/refunds`, not a source** — editing one of those pages without editing that
file publishes a promise to Google the site does not make to a person, and
Google enforces it against the merchant. Where the prose is richer than the
schema, the stricter reading wins: refunds are generous on a defect and narrow
on sizing, and the sizing case is what is encoded.

Deliberately absent, each for a reason worth keeping:

- `aggregateRating` / `review` — there are no reviews, and inventing them is the
  one structured-data offence Google issues manual actions for.
- `priceValidUntil` — a date in the past makes Google drop the price entirely,
  and nothing knows when a price expires.
- `gtin` / `mpn` — these objects have neither.

---

## 4. Crawl surfaces

All four are served, not static, and all four 404 or `Disallow: /` off
production — a staging copy of the storefront competing with the real one in an
index is how the real one gets lost.

### `/robots.txt`

Named AI-crawler groups **restate the disallows**. Google's specification is
explicit that a crawler obeys the most specific matching group and does not
merge it with `*`, so a `User-agent: GPTBot` group saying only `Allow: /` would
hand it the cart. The duplication is load-bearing.

Carries a Cloudflare Content Signals line:

```
Content-Signal: search=yes, ai-input=yes, ai-train=no
```

Index it, quote it with attribution, do not put it in the weights. **This is the
one line in this change that is a business decision rather than a technical
one** — it lives in `src/pages/robots.txt.ts` and is a one-word edit. It is a
signal, not a lock; enforcement is Cloudflare's bot controls.

### `/sitemap.xml`

Not `@astrojs/sitemap` — that integration walks build-time routes, and
`/shop/[slug]` is on-demand, so the only product URL it could emit is the
literal `[slug]`. This reads the catalogue in **both markets** and unions them:
`listStorefront` hides a product with no live row in the market asked about, and
the market changes prices, never addresses.

`<loc>` only. `<changefreq>` and `<priority>` are ignored by Google outright,
and every `<lastmod>` this could emit would be invented — the storefront DTO
carries no modification time.

A binding failure is **503, not a short sitemap**. A crawler treats 5xx as "come
back later"; a 200 listing only static routes says every object was withdrawn.

### `/llms.txt` and the `.md` twins

Honest assessment: **this does nothing for Google Search** — Google has said so
— and measured crawl volume for the format is small. It is served for the
narrower thing it demonstrably is: Anthropic recommends it and Claude honours it
in retrieval, and it tells an agent in one fetch that every page has a markdown
twin. It costs ~60 lines composed from documents the pages already render.

Twins live at `<path>.md` (`/index.md` for the root). **The four policy pages
have none, on purpose** — their prose lives in `.astro` markup, so a twin would
mean a second copy of a refund policy. They are linked from `llms.txt` as HTML.
Moving that prose into documents the way `about-document.ts` does is what would
unblock them.

---

## Checklist for a new page

- [ ] `<Base title description>` — both, always.
- [ ] `jsonLd={pageGraph({ ... })}` unless the page is one person's transaction.
- [ ] `noindex` if it is.
- [ ] Add the path to `STATIC_PATHS` in `src/core/sitemap.ts` if it is indexable.
- [ ] A `.md` twin plus `markdownAlternate` if its content is data rather than
      markup — and a link in `src/core/llms.ts` either way.
