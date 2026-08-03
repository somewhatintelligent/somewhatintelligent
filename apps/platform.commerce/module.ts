import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { CommerceDatabase, CommerceSchema, MediaBucket } from "./runtime.ts";
import { environmentFor, type StripeEnvironment } from "./services/StripeConfig.ts";
import CommerceWorker from "./workers/Commerce.ts";
import MediaWorker from "./workers/Media.ts";
import SettlementWorker from "./workers/Settlement.ts";

/**
 * THE DEPLOYABLE UNIT, and everything it owns.
 *
 * Parameterless, like `platform.auth`'s: every resource below reads the stage it
 * needs from `Alchemy.Stack` itself, so a composer never passes one down. The
 * state layer, the providers and the adopt policy live in
 * `stacks/platform.commerce/` — they are composition, not this app's business.
 *
 * WHAT IS DEPLOYED, AND WHAT EACH ONE IS ADDRESSABLE FOR:
 *
 *   Commerce    no address at all. The whole domain — 30 methods — reachable
 *               only over a service binding. It performs NO authorization of its
 *               own; it trusts `meta.actor` as already validated by whoever
 *               bound it. The binding IS the boundary.
 *   Settlement  one public route, `POST /webhook`, authenticated by an HMAC over
 *               the raw body against a secret only the provider and this
 *               deployment hold. Plus a queue consumer and a cron, neither of
 *               which is addressable. Its `settleNow` / `sweepNow` / `provider`
 *               methods are binding-only.
 *   Media       one public route, `GET /media/:id`. Read-only, and the only
 *               reason it is public is that `Contracts.mediaHref` spells media
 *               addresses root-relative — see `workers/Media.ts`.
 *
 * THERE IS NO UNAUTHENTICATED WRITE PATH IN THIS SET, and that is a property to
 * check rather than a claim to trust: it holds because no worker here mounts an
 * `RpcServer` over HTTP, and the only two `fetch` handlers are the signature-
 * verified webhook and a `GET`-only media route.
 *
 * THERE IS ALSO NO TEST DOUBLE IN IT. `PaymentsProvider.resolve` knows one
 * provider; a stage that cannot configure Stripe fails the deploy. The fake and
 * the two Workers that may use it live under `tests/`, which this file cannot
 * import — so no deployed bundle contains the fake and no deployed database
 * carries its table. The spike had both: the fallback was gated to `dev` but
 * still shipped in every bundle, and `fake_session` was in the one migration set
 * applied to every stage.
 *
 * The spike also had three HTTP Workers — an operator RPC surface, an anonymous
 * storefront, and a console SPA — every one of which minted an actor from a
 * hardcoded constant. The first two are in `tests/workers/`, where they belong:
 * they exist so the integration suite can drive a deployed stack over HTTP,
 * which is the only reason they ever existed. The console is not ported.
 *
 * WHAT A CONSUMING APP DOES. It binds `CommerceWorker` — `bindWorker` from an
 * Effect worker, `env: { COMMERCE: CommerceWorker }` from a plain one — and
 * mints `meta.actor` from its own session. That app has to be declared in the
 * SAME stack: a service binding names a resource its stack owns and does not
 * cross a stack boundary, which is the same reason `Auth` publishes an origin
 * rather than a binding. `stacks/platform.commerce/alchemy.run.ts` is where it
 * would go.
 */
export const CommerceModule = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;

  /**
   * The schema resource resolves FIRST: it regenerates migration SQL when
   * `domain/Schema.ts` drifts, and the database applies whatever is in that
   * directory. Declaring it here fixes the ordering rather than leaving it to
   * whichever worker happens to resolve the database first.
   */
  yield* CommerceSchema;
  const database = yield* CommerceDatabase;
  yield* MediaBucket;

  /**
   * YIELDED EXPLICITLY, and it has to be. Nothing in this module binds Commerce
   * — Settlement and Media reach D1 and R2 directly — so without this line the
   * one Worker the whole package exists to publish is never in the resource
   * graph. It deploys with no caller, which is the correct state: the caller is
   * a consuming app that does not exist yet.
   */
  yield* CommerceWorker;

  const settlement = yield* SettlementWorker;
  const media = yield* MediaWorker;

  return {
    /**
     * Which Stripe account this deployment settles against, derived from the
     * stage by the same function the Workers use. A consumer reads it to decide
     * whether it is looking at real money.
     */
    paymentsEnvironment: environmentFor(stage) satisfies StripeEnvironment,

    /**
     * Where to register the provider's endpoint. THE COMPLETE URL, path included
     * — a caller pastes this into a Stripe endpoint configuration rather than
     * composing it. `tests/alchemy.run.ts` publishes the bare ORIGIN under
     * `settlementUrl` instead, because its callers append the path themselves;
     * confusing the two yields `/webhook/webhook` and a 404 on every event.
     *
     * THE TRAILING SLASH IS NOT COSMETIC, and this is where the spike lost a
     * payment to it. `alchemy dev` formats a local worker URL WITH one
     * (`http://localhost:1338/`) while a deployed `*.workers.dev` URL has none,
     * so the obvious `` `${settlement.url}/webhook` `` yields `…//webhook`
     * locally. Settlement matches `path !== "/webhook"` exactly, so every
     * forwarded event 404s — the payment succeeds at Stripe and the order
     * silently stays `pending/unpaid`, which reads as a settlement bug and is a
     * URL bug. Deployed runs were unaffected, which is why the end-to-end suite
     * never caught it.
     */
    webhookUrl: Output.interpolate`${Output.map(settlement.url, (url: string | undefined) =>
      (url ?? "").replace(/\/+$/, ""),
    )}/webhook`,

    /**
     * What `Contracts.mediaHref`'s root-relative `/media/<id>` resolves against.
     * A storefront either serves from this origin or proxies it.
     */
    mediaOrigin: Output.map(media.url, (url: string | undefined) =>
      (url ?? "").replace(/\/+$/, ""),
    ),

    /**
     * The physical D1 name. Published so the integration suite can ARRANGE state
     * the public surface cannot reach — an order already attached to a settled
     * session, say — and then exercise the real code path against it. Reading and
     * writing the same database the Workers use keeps that honest: nothing is
     * mocked, only set up. See `tests/Seed.ts`.
     */
    databaseName: database.databaseName,
    databaseId: database.databaseId,
  };
});
