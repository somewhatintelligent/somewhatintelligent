# Operational system: the attractive parts must survive contact with data

> **Historical architecture note.** This document describes the previous worker-based platform at the time the mockups were created. It is retained as design provenance, not as a specification for this repository. Current authority lives in `apps/platform.site`, `apps/platform.commerce`, `apps/platform.auth`, and their present contracts.

The working interface should keep one premise: an account, cart, and admin tool are not a separate "back office." They are records in the same publishing apparatus. The typography, evidence strips, terse state labels, and one pink private annotation carry through; the interaction model stays familiar, calm, and accessible. Public releases use semantic versions.

## What already exists

| Concern                | Authority                      | Existing behavior                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and account   | `workers/identity` + Guestlist | Sign-in/sign-up, passkeys, sessions, providers, two-factor, API keys, organizations, and account management live here. Storefronts consume the shared signed-in session; they do not make auth tables.                                         |
| Catalog and stock      | Store D1                       | `product`, `product_image`, and `product_variant` hold catalog copy, publishing state, ordered imagery, SKUs, and non-negative stock. Admin-only server functions create/edit products and variants.                                           |
| Product media          | Roadie / R2                    | Store D1 keeps an image reference id; Roadie owns the bytes. The admin browser uploads directly to signed URLs, then finalizes the reference. The public store resolves it through `/api/img/$refId`.                                          |
| Cart                   | Browser localStorage           | The current cart is deliberately a client-side display snapshot (`si.store.cart.v1`) synchronized across tabs. The server re-prices every variant at checkout, so client data can never set a price.                                           |
| Orders and fulfillment | Store D1 + Stripe              | `customer_order` and immutable `order_item` snapshots keep shipping, payment, and fulfillment state. Stripe events are idempotently ledgered; failures land in a durable dead-letter table and a reconciliation cron heals stale reservations. |
| Admin access           | Shared session role            | `/admin` is role-gated; the implemented navigation is dashboard, catalog, and orders.                                                                                                                                                          |

## The right extension for products, writing, and releases

Do not turn a product row into a miscellaneous CMS blob. Keep commerce in the Store D1 database, and add a small **Publishing** D1 boundary (either a dedicated worker or a clearly bounded package once there is enough surface area). That gives the public site a durable source of truth without coupling a shirt variant to an essay revision.

The minimum publishing model is:

```text
entry
  id, kind (essay | page | release-note | system), slug, title,
  summary, state (draft | published | archived), published_at,
  current_revision_id, authored_by, created_at, updated_at

entry_revision
  id, entry_id, body_markdown, body_html, metadata_json,
  revision_number, created_by, created_at

entry_asset
  entry_id, roadie_reference_id, role (cover | inline | attachment),
  alt, position, attached_at

site_navigation
  id, location, label, href, position, visibility
```

Each new revision is append-only. Publish changes the entry's `current_revision_id`; it never overwrites the document a reader saw yesterday. That is the functional counterpart to `revision is the public form of doubt.`

The existing Roadie/R2 reference pattern should be reused verbatim for essay PDFs, covers, images, audio, and downloadables. No application should own a second file-store abstraction.

## Practical UX rules

- Public forms look like a clear record, not a surveillance checkpoint.
- Account is useful: security, sessions, passkeys, orders, subscriptions, and API keys; no vague social feed.
- Cart is local until checkout. If cross-device carts become worth the complexity, add `cart` and `cart_line` in Store D1 keyed by user id; retain server-side price validation.
- Product editing is a release workflow: draft → active → archived, with variants and Roadie assets beside the copy.
- Text editing is a revision workflow: draft → preview → publish revision, with attachments as named evidence.
- Admin remains a privileged operator interface. `APOSTOLI / NOT FOR HIRE` is provenance and boundary, not an invitation to contact support.

## Image set

`09`–`12` depict existing product capabilities restyled: sign-in, account/security, cart, and catalog editing. `13` is intentionally marked proposed: it visualizes the Publishing D1 extension above, because the current Store app does not yet persist first-class essays/pages.
