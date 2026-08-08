# RFC-002 — Subscriptions, and the abstraction apps check them through

**Status:** Proposed
**Affects:** `platform.auth` (schema, config, RPC, account UI), `platform.commerce`
(Stripe config), `infra`, new package `platform.entitlements`

## Context

The platform sells two things against one Stripe account. The store
(`platform.commerce`) settles one-off orders and has since v2. The registry the
brand study describes — "Systems — software and subscriptions", a page per system
with "what it costs and what access includes" — sells subscriptions, and nothing
in the repository implemented them.

Better Auth ships `@better-auth/stripe`, which is the obvious answer for the
first half: customers, checkout, the billing portal, webhooks, and a
`subscription` table. It is not an answer for the second half at all. The plugin
tells an application **which plan a person is on**, and every question an
application actually has is of the form _may this person do this_.

That gap is where the damage happens, and it is worth being precise about the
failure it produces, because it is silent:

```ts
// the shape this RFC exists to prevent
if (subscription?.plan === "patron") allowServerCode();
```

Add a tier next quarter and that branch is false for the customer paying the
most. Nothing errors. Nothing fails a test. The only signal is a support email.
The same code copied into three apps is three places to forget, and the plugin's
own `plans[].limits` — `Record<string, unknown>` — invites each of them to
re-invent the key names and their types.

There is a second, sharper problem specific to this repository. `authConfig` is
resolved **twice**: once inside the deployed Worker, and once on the deploy host,
where `api/schema.ts` generates the Drizzle schema and `lib.better-auth-manifest`
derives the feature manifest. A plugin whose presence depends on a secret
therefore makes the **database shape** depend on a secret — and `drizzle-kit`
would emit a migration dropping the table on any stage that lacked one.

### Non-goals

- Organisation (B2B) billing. `organization.enabled` stays off; see ADR-9.
- Metered or usage-based pricing.
- Tax configuration for digital subscriptions. See "What this leaves open".
- Entitlement claims in OAuth id tokens for third-party clients. See Stage 3.
- A pricing page on the public site. The registry is a separate track.

## ADRs

### ADR-1 — Application code branches on a capability, never on a tier name

**Decision.** `platform.entitlements` declares a closed set of named
capabilities. Everything that decides what may happen asks for one:

```ts
if (!allows(entitlements, "mezedes.serverCode")) return refuse("upgrade");
if (!within(entitlements, "mezedes.mezes", owned + 1)) return refuse("limit");
```

Tier names appear in exactly two places: the catalogue, and any surface
_displaying_ the name to the person who bought it.

**Why the alternative loses.** Branching on the plan name distributes the
tier→capability mapping across every call site, and every one of them is a place
a new tier is silently missing. The mapping is product policy; policy that lives
in twelve `if`s is policy nobody can read or change.

### ADR-2 — The catalogue is total, and totality is enforced by the type

**Decision.** `Entitlements` is a mapped type over every key in `ENTITLEMENTS`,
and every tier declares a value for every key. There are no partial records and
no defaults.

**Why the alternative loses.** `Partial<Entitlements>` plus a default reads as
convenience and is the mechanism by which the free tier gets a paid feature: an
absent key is `undefined`, and `undefined` is falsy in one call site and passed
into `Math.min` in another. With totality, adding a capability is a compile error
at **every** tier until each has answered it — which is exactly the review
conversation that ought to happen.

### ADR-3 — Prices are named by Stripe **lookup key**, never by price id

**Decision.** A tier declares `si_subscriber_monthly`, not `price_1AbC…`. The
operator creates a Price carrying that `lookup_key` in each Stripe mode.

**Why the alternative loses.** A price id is minted per mode, so pinning ids
means a per-stage environment variable for every tier × interval — four
variables today, and the failure mode of getting one wrong is _charging the wrong
amount_, not an error. Lookup keys are strings this repository chooses; the same
key exists in test mode and live mode, so the catalogue is stage-independent and
checked in. `@better-auth/stripe` resolves a lookup key to a price at checkout
and matches it back on the webhook (`resolveStripePrice`, `resolvePlanItem`).

### ADR-4 — A tier is retired, never deleted

**Decision.** `purchasable: false` removes a tier from the pricing table and from
the plugin's plan list. The entry itself stays forever.

**Why the alternative loses.** `subscription.plan` holds the tier id for as long
as the row exists. Deleting the entry makes `tierIdOf` fail to recognise it, and
every subscriber on that tier silently drops to `free` — a revocation, applied to
paying customers, caused by a tidy-up.

### ADR-5 — The wire carries the subscription **fact**; entitlements resolve locally

**Decision.** The IdP answers with `Membership` — `{ plan, status, periodEnd,
cancelAtPeriodEnd }`. Each consumer runs `grantFor` from its own copy of
`platform.entitlements`.

**Why the alternative loses.** Sending a resolved `Entitlements` makes the wire
format change shape every time a capability is added, and an app on an older
deploy receives a record missing keys it is about to index. Sending the fact
means the contract is four fields with no reason to change, and an app that has
not yet deployed a new capability simply does not offer it — correct behaviour,
not a degradation. Adding a capability then needs **no IdP deploy at all**.

**What this costs.** Two apps on different deploys of the package can disagree
about what `subscriber` buys. Accepted, and bounded: they cannot disagree about
_who_ is a subscriber, which is the fact money was exchanged for.

### ADR-6 — The plugin's `plans[].limits` is not used

**Decision.** No plan sets `limits`. `GET /subscription/list` therefore echoes
nothing back, and no consumer reads entitlements off the wire.

**Why the alternative loses.** It is `Record<string, unknown>`. Using it puts the
entitlement values in two places — the plugin config and the catalogue — with
nothing checking they agree, and hands every reader an untyped bag to cast.

### ADR-7 — `past_due` keeps its grant; a frozen row loses it

**Decision.** `active`, `trialing` and `past_due` entitle. `unpaid`, `paused`,
`incomplete`, `incomplete_expired` and `canceled` do not. Independently, a row
whose `periodEnd` is more than `RENEWAL_GRACE_MS` (7 days) in the past stops
entitling whatever its status claims.

**Why.** Stripe moves a subscription to `past_due` on the _first_ failed charge
and then retries for days; cutting access off at that moment is a support ticket
about a card that succeeds on Thursday. `unpaid` is where Stripe puts it once the
retries are exhausted — so the grace period is Stripe's dunning schedule rather
than a number invented here.

The `periodEnd` cutoff bounds a **webhook outage**. Every status transition
arrives as a webhook, so a rotated signing secret or a 500ing endpoint freezes
every row in its last state — and `active` with a `periodEnd` two years past
would otherwise grant everything, forever, with nothing reporting a problem.

### ADR-8 — The Stripe plugin is mounted unconditionally

**Decision.** `stripe({ subscription: { enabled: true } })` is always in
`plugins`. A stage with no Stripe credentials gets a client that throws on any
use and an empty webhook secret; the endpoints exist and refuse.

**Why the alternative loses.** This is the deploy-host problem from the Context.
Mounting conditionally makes the generated schema depend on a secret: a stage
without the key generates a schema with no `subscription` table, and `drizzle-kit
generate` emits a migration **dropping** it. Endpoints that refuse are
recoverable. A dropped table is not.

### ADR-9 — Missing billing config is a state; incoherent billing config is fatal

**Decision.** In `platform.auth`:

| Configuration                                          | Outcome                     |
| ------------------------------------------------------ | --------------------------- |
| neither variable set                                   | billing off, warning logged |
| endpoint secret only                                   | billing off, warning logged |
| secret key, no endpoint secret                         | **die**                     |
| live key outside production, or test key on production | **die**                     |

**Why this differs from the store.** `platform.commerce` dies whenever its Stripe
config does not resolve, and that is right for a surface whose entire job is
settling payments. This is the IdP: sign-in, passkeys, OAuth and organisation
invitations all work without Stripe, and refusing to boot because a subscription
price is unset would be a self-inflicted outage.

Half a configuration is fatal because nobody sets a live secret key by accident.
A key with no endpoint secret means someone intended to sell subscriptions and
stopped one step short — and booting would mount a checkout that takes money and
a webhook that can never verify the result: the subscription stays `incomplete`,
the customer is charged, and nothing raises. That failure lands on the **deploy
host**, before anything is uploaded.

### ADR-10 — No `authorizeReference`, and its absence is load-bearing

**Decision.** `subscription.authorizeReference` is not configured.

**Why.** With organisation billing off, a subscription's reference id is always
the caller's own user id — and `@better-auth/stripe`'s `referenceMiddleware`
**refuses** any explicit `referenceId` that is not the session's own when no
`authorizeReference` is configured (`REFERENCE_ID_NOT_ALLOWED`). Writing one
replaces a deny-by-default with a predicate that has to be correct, for five
actions, forever. It becomes required the day ADR-11 is reversed.

### ADR-11 — One Stripe **account**, two webhook **endpoint** secrets

**Decision.** `STRIPE_SECRET_KEY` moves to `@swi/infra/stripe` and is read by
both the store and the IdP. Each surface names its own endpoint secret:
`STRIPE_WEBHOOK_SIGNING_SECRET` (store) and
`STRIPE_AUTH_WEBHOOK_SIGNING_SECRET` (IdP).

**Why.** One account is a product requirement: a customer who buys a shirt and a
subscription must be one Stripe Customer with one payment method, or support
cannot reconcile them. The plugin even links an existing Customer by email when
the address is verified, so the store's buyers and the IdP's subscribers converge
on one record. But Stripe signs with a secret minted **per registered endpoint**,
so a shared name would give whichever surface deployed second a secret that
verifies nothing — and a webhook that fails verification is indistinguishable
from one that never arrived.

The tier→environment mapping and the live-key guard moved with it, because their
whole job is that both surfaces reach the same verdict.

### ADR-12 — One ladder of tiers, not a subscription per system

**Decision.** `free` → `subscriber` → `patron`, each granting a set of
system-scoped capabilities.

**Why the alternative loses.** It is forced rather than preferred:
`@better-auth/stripe` supports exactly one active-or-trialing subscription per
reference id. Per-system subscriptions would need a reference id per system and
an `authorizeReference` rule for each (reversing ADR-10), to express a product
that a ladder expresses with one row per customer.

### ADR-13 — Organisation billing stays off

**Decision.** `stripe({ organization: … })` is omitted even though the
`organization` plugin runs.

**Why.** `allowUserToCreateOrganization` is `false` and nothing sells to an
organisation. Enabling it adds an `organization.stripeCustomerId` column and a
seat-sync hook serving nobody. Turning it on later is one nullable column —
cheaper than removing one.

## Schema

`apps/platform.auth/api/schema.gen.ts`, regenerated; migration
`20260808072353_heavy_slapstick`. Purely additive.

```sql
CREATE TABLE `subscription` (
  `id` text PRIMARY KEY,
  `plan` text NOT NULL,                          -- a TierId, lower-cased by the plugin
  `reference_id` text NOT NULL,                  -- the user id; see ADR-10
  `stripe_customer_id` text,
  `stripe_subscription_id` text,
  `status` text DEFAULT 'incomplete' NOT NULL,
  `period_start` integer, `period_end` integer,
  `trial_start` integer,  `trial_end` integer,
  `cancel_at_period_end` integer DEFAULT false,
  `cancel_at` integer, `canceled_at` integer, `ended_at` integer,
  `seats` integer, `billing_interval` text, `stripe_schedule_id` text
);
ALTER TABLE `user` ADD `stripe_customer_id` text;
```

`reference_id` is deliberately **not** unique — a customer must be able to
resubscribe after cancelling, which means more than one row per user over time.

**There is no index on it, and that is a debt rather than a decision.** It is the
only table in `schema.gen.ts` without one — `apikey_referenceId_idx`,
`session_userId_idx` and `member_userId_idx` are the structurally identical
cases. `@better-auth/stripe` queries `referenceId` at eight sites and
`stripeSubscriptionId` at seven, all of them webhook and `/subscription/*`
handlers, so every Stripe webhook is a full scan of the table plus a sort for the
`ORDER BY period_end`. D1 bills on `rows_read`. At zero rows this costs nothing
and it is not worth hand-editing a generated file for; the fix belongs in
`api/drizzle-v1.ts`, which already post-processes the generator's output, and it
should land before the table carries real subscribers.

## API surface

### `platform.entitlements` (pure, no dependencies, no clock)

| Export                                      | Contract                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `ENTITLEMENTS`                              | the closed set of capability keys and their kind (`flag` \| `quota`)      |
| `TIERS`, `TierId`, `BASE_TIER`              | the catalogue; `tierIdOf` narrows a stored plan string, `null` if unknown |
| `PURCHASABLE_PLANS`                         | the plan list the IdP hands the plugin                                    |
| `Membership`, `decodeMembership`            | the wire fact, and a **total** decoder — `null` for a row it cannot read  |
| `entitles`, `resolveTier`, `grantFor`       | resolution; every one takes `now` explicitly                              |
| `allows`, `limitOf`, `within`, `isQuotaKey` | the checks, and the guard that narrows a key to its kind                  |

`within(entitlements, key, count)` answers about the **resulting** state: a
caller creating one more passes `owned + 1`. The obvious `used < limit` is right
only when exactly one thing is created and is off by the batch size otherwise.

### `platform.auth`

| Surface                                                      | Contract                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `getMembership({ cookie })` (Worker RPC)                     | `{ memberships, stripeSubscriptionId, billing }`. Never fails: no session, no rows, or an undecodable row all answer `[]` |
| `fetchMembership()` (server fn)                              | the above plus `grant`, resolved with one `Date.now()` at the edge                                                        |
| `POST /api/auth/stripe/webhook`                              | the plugin's endpoint; signature-verified against `STRIPE_AUTH_WEBHOOK_SIGNING_SECRET`                                    |
| `/subscription/{upgrade,cancel,restore,list,billing-portal}` | the plugin's, session-gated                                                                                               |

`getMembership` reads the table directly rather than calling
`auth.api.listActiveSubscriptions`, which filters to `active | trialing` and
would silently drop the `past_due` row ADR-7 exists to keep granting. Filtering
there would put the policy in two places and let the wrong one win.

`stripeSubscriptionId` rides alongside `Membership` rather than inside it: it
names Stripe, and `Membership` is the vendor-free fact. `subscription.upgrade`
without it opens a **second** checkout beside the running subscription and bills
the customer twice.

## Invariants

Each is a test.

- **INV-1** — Every tier answers every key in `ENTITLEMENTS`, and no tier answers
  a key the catalogue does not declare.
- **INV-2** — Resolution is total: no memberships, an unentitling status, an
  unknown plan id, and a signed-out visitor all resolve to `BASE_TIER`. Nothing
  in the resolution path throws.
- **INV-3** — `past_due` entitles; `unpaid` does not.
- **INV-4** — A membership whose `periodEnd` is older than `RENEWAL_GRACE_MS`
  does not entitle, whatever its status says.
- **INV-5** — An unrecognised status decodes to `null` — never to a guess — and a
  dropped row does not suppress a valid one beside it.
- **INV-6** — Every offered plan names a lookup key, and no lookup key looks like
  a `price_…` id.
- **INV-7** — A retired tier is absent from `PURCHASABLE_PLANS` and still
  resolves through `tierIdOf`.
- **INV-8** — `platform.auth` resolves with no Stripe credentials on every
  environment including production, and refuses to resolve with a key and no
  endpoint secret, a live key off production, or a test key on production.
- **INV-9** — The switched-off client throws on any property access, so an
  unconfigured stage makes no outbound request to Stripe.
- **INV-10** — `stripe` is in the running plugin set, so `SURFACES.SUBSCRIPTION`
  is never a dead flag (`test/surfaces.test.ts`, which pins every surface).

## Threat model

| Attempt                                                               | What stops it                                                                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read or cancel another person's subscription by passing `referenceId` | `referenceMiddleware` refuses a foreign reference id outright when no `authorizeReference` is configured (ADR-10)                                               |
| Forge a webhook to mint a subscription                                | Signature verification against this endpoint's own secret; an unconfigured stage has an empty secret and refuses every call                                     |
| Replay a test-mode webhook at production                              | Production cannot resolve on a test key (ADR-9), so a production deployment verifies only against the live endpoint's secret                                    |
| Deploy a live key to a staging stage and take real payments           | `assertKeyMatchesEnvironment`, derived from the key prefix and the validated stage tier                                                                         |
| Farm free trials with throwaway addresses                             | `requireEmailVerification: true` on upgrade, plus the plugin's per-customer one-trial rule                                                                      |
| Tamper with the grant in the browser to unlock a feature              | The grant that reaches the browser decides what is **rendered**. Anything that decides what may **happen** resolves it again server-side from `fetchMembership` |
| Keep access forever by breaking the webhook endpoint                  | The `periodEnd` cutoff (ADR-7) stops a frozen row entitling a week after the period paid for                                                                    |
| Delete an account with a live subscription                            | **Not yet closed** — see below                                                                                                                                  |

## Stages

**Stage 1 — this change.** `platform.entitlements`; the plugin mounted in
`platform.auth` with the schema and migration; `@swi/infra/stripe` shared with
the store; the `getMembership` RPC; the account card, which is the worked example
of the abstraction.

**Before Stage 1 can deploy**, an operator must, once:

1. Register a webhook endpoint at
   `https://accounts.somewhatintelligent.ca/api/auth/stripe/webhook` for
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
2. `dotenvx set STRIPE_AUTH_WEBHOOK_SIGNING_SECRET <whsec_…> -f .env.production`
   (encryption is public-key; no private key needed).
3. Create a Price per `PURCHASABLE_PLANS` entry carrying that entry's
   `lookup_key`, in both test mode and live mode.

Until (2), a production deploy **fails on the deploy host** — by design (ADR-9).

**Stage 2 — enforcement at a system.** `mezedes` is the first system with
capabilities to enforce (`systems.mezedes`, `mezedes.mezes`,
`mezedes.serverCode`). It authenticates through Cloudflare Access today and has
no Better Auth session; giving it one is the bulk of that stage, and the
entitlement half is `grantFor` plus two `within` calls.

**Stage 3 — entitlements for OAuth clients.** The IdP already mints `role` into
id tokens and userinfo (`customIdTokenClaims`). A `plan` claim plus a validity
window would let a third-party client resolve entitlements with no call back to
the IdP. Deliberately not in Stage 1: a claim is cached for the token's lifetime,
so it needs a documented revocation latency and a forced-refresh path, and
neither is worth designing before a client exists that needs it.

## What this leaves open

- **Tax.** `automatic_tax` is not enabled. Enabling it without tax registrations
  configured in Stripe makes checkout fail, and digital-services tax is a
  decision an operator makes, not a default a deploy should assume. Until then,
  prices are tax-inclusive by whatever the dashboard says.
- **Account deletion with a live subscription.** Organisations with active
  subscriptions are blocked from deletion by the plugin; users are not. Closing
  it is a `user.deleteUser.beforeDelete` callback that refuses while a
  non-terminal Stripe subscription exists.
- **`api/inert.ts` is a workaround, and Billing is the evidence.** Alchemy's
  blessed model is one init Effect that runs in BOTH phases — at plantime to
  discover bindings, at cold start to build clients — with `__ALCHEMY_RUNTIME__`
  fencing only the deploy-time wiring. `api/capabilities.ts` is exactly that
  shape. `inert.ts` exists because `api/options.ts` resolves `authConfig` at
  MODULE SCOPE (`Effect.runSync`), outside any phase, where `live` cannot be used
  because it needs `Alchemy.Stack` and the bindings — so every capability needs a
  hand-written stand-in. Resolving the config inside the Worker's init phase, and
  generating the schema from there, would delete the file. That is an
  `options.ts`/`schema.ts` restructure and deliberately out of scope here.

  Billing does not add to the problem: on the deploy host there genuinely is no
  Stripe account bound, so `Option.none()` is the true answer rather than a
  stand-in that pretends. Two routes that look blessed and are not, checked and
  rejected: `ProviderLayer.dual` / `LocalProvider.make` model a second
  implementation of a RESOURCE lifecycle for `alchemy dev`, and Billing is a
  capability tag, not a resource; and colouring the client's methods with
  `Alchemy.RuntimeContext` — which would make a deploy-host read a COMPILE error
  rather than a throw — is closed off by `@better-auth/stripe`, which takes a
  plain `Stripe` instance, for the same reason bae's `Database` hands back a
  resolved value rather than a coloured Effect.

- **Local development.** The store arms `stripe listen` from
  `infrastructure/StripeDev.ts` and injects the signing secret at deploy time. The
  IdP has no equivalent, so a developer exercising subscriptions locally must run
  `stripe listen --forward-to localhost:1350/api/auth/stripe/webhook` themselves
  and export the printed secret. Generalising `StripeDev` to arm a second
  endpoint is the obvious follow-up.
