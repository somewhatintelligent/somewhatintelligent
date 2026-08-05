/**
 * THE TEST STACK. Never deployed to a real stage, and structurally incapable of
 * being confused with the one that is.
 *
 * It declares the same resources `stacks/platform.commerce/alchemy.run.ts` does
 * — the schema, the database, the bucket, the queue, and the read-only media
 * worker — and then FOUR Workers the deployed stack does not have:
 *
 *   tests/workers/Commerce.ts    the 30-method surface, on a provider that may
 *   tests/workers/Settlement.ts  fall back to the fake when this machine has no
 *                                Stripe. Both import the same `*Surface.ts` the
 *                                deployed entries do, so a green suite is
 *                                evidence about the code that ships.
 *   tests/workers/Edge.ts        HTTP ingress, so a test process — which is not
 *   tests/workers/Storefront.ts  a Worker and cannot hold a service binding —
 *                                can reach a deployed stack at all.
 *
 * It does NOT compose `CommerceModule`. It cannot: that module declares the real
 * Commerce and Settlement, and deploying those alongside these would put four
 * provider-holding Workers on one database, two of them settling against a
 * different provider than the other two checked out on.
 *
 * WHY THIS IS SAFE. A different stack NAME is a different state key, so nothing
 * here can adopt, reconcile or destroy what the deployed stack owns. And every
 * file above is under `tests/`, which `module.ts` cannot reach — so no import
 * path exists by which `alchemy deploy` on the real stack could pull in an HTTP
 * entrypoint, the fake provider, or its table.
 *
 * `localState`, not `Cloudflare.state()`: a throwaway stage's state does not
 * belong in the account's shared store, and a suite that fails its teardown
 * should leave a local file behind rather than a remote record of resources it
 * no longer manages.
 */
import * as Alchemy from "alchemy";
import { StageTier } from "@swi/infra/StandardizedStage";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as StripeDev from "../infrastructure/StripeDev.ts";
import { CommerceDatabase, CommerceSchema, MediaBucket } from "../runtime.ts";
import { environmentFor } from "../services/StripeConfig.ts";
import MediaWorker from "../workers/Media.ts";
import TestCommerceWorker from "./workers/Commerce.ts";
import EdgeWorker from "./workers/Edge.ts";
import TestSettlementWorker from "./workers/Settlement.ts";
import StorefrontWorker from "./workers/Storefront.ts";

/**
 * ARMED AT MODULE LOAD, for the same reason the deployed stack arms there: a
 * `Config` resolved during a Worker's init is what records the Cloudflare secret
 * binding, and `ConfigProvider.fromEnv()` snapshots `process.env` before the
 * stack body runs. Arming from inside the body would leave every `Config` in the
 * graph blind to the CLI's key and silently deploy the fake payment provider —
 * which the settlement suite would still pass against, and the end-to-end suite
 * would fail with no indication why.
 */
/**
 * `arm()` UNCONDITIONALLY, where the deployed stack gates on `alchemy dev` —
 * deliberately different, because this stack registers no webhook endpoint:
 * the suite forwards events with its own `stripe listen`, so the CLI's key and
 * signing secret are the only pair its workers could ever verify. Explicitly
 * exported variables still win inside `arm`, so CI can supply its own.
 */
const stripeArmed = await Effect.runPromise(StripeDev.arm());

export default Alchemy.Stack(
  "PlatformCommerceTests",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    /**
     * The schema resource resolves FIRST: it regenerates migration SQL when
     * `domain/Schema.ts` drifts, and the database applies whatever is in that
     * directory.
     */
    yield* CommerceSchema;
    const database = yield* CommerceDatabase;
    yield* MediaBucket;

    /**
     * YIELDED EXPLICITLY for the same reason `module.ts` yields the real one:
     * nothing binds Settlement here, so without this line the Worker that owns
     * the queue consumer and the cron would never enter the resource graph.
     * Commerce IS bound (by Edge and Storefront) but is yielded anyway, so the
     * two provider-holding Workers are visibly declared as a pair.
     */
    yield* TestCommerceWorker;
    const settlement = yield* TestSettlementWorker;
    yield* MediaWorker;

    const edge = yield* EdgeWorker;
    const storefront = yield* StorefrontWorker;

    /**
     * THE ORIGIN, NOT THE WEBHOOK URL, and the difference costs a payment.
     *
     * `settlementUrl` below is published bare because the five call sites in
     * `stripe.e2e.test.ts` compose `` `${settlementUrl}/webhook` `` themselves.
     * Publishing the complete URL instead — which is what `module.ts` does, for
     * a caller that wants exactly that — makes those five compose
     * `/webhook/webhook`, and Settlement matches `path !== "/webhook"` exactly,
     * so every forwarded event 404s. The payment succeeds at Stripe and the
     * order silently stays `pending/unpaid`, which reads as a settlement bug and
     * is a URL bug. Observed, not hypothesised.
     *
     * THE TRAILING SLASH IS NOT COSMETIC EITHER, and it is the same failure by a
     * different route — the one the spike actually shipped. `alchemy dev` formats
     * a local worker URL WITH one while a deployed `*.workers.dev` URL has none,
     * so `${settlement.url}/webhook` yields `…//webhook` locally. Stripping here
     * means both halves of the composition are correct wherever it runs.
     */
    const settlementOrigin = Output.map(settlement.url, (url: string | undefined) =>
      (url ?? "").replace(/\/+$/, ""),
    );
    const webhookUrl = Output.interpolate`${settlementOrigin}/webhook`;

    /**
     * A no-op under `alchemy deploy`, which is how the suites run — they start
     * `stripe listen` themselves against the deployed URL, using the same
     * `listenCommand`. This is here so `alchemy dev` on the test stack behaves
     * like `alchemy dev` on the real one.
     */
    if (stripeArmed && environmentFor(yield* StageTier) === "dev") {
      yield* StripeDev.forwarder(webhookUrl);
    }

    return {
      /**
       * The physical D1 name, so a suite can ARRANGE state the public surface
       * cannot reach — an order already attached to a settled payment session,
       * say — and then exercise the real code path against it. See `Seed.ts`.
       */
      databaseName: database.databaseName,
      /** The ORIGIN. Callers append `/webhook` — see the note above. */
      settlementUrl: settlementOrigin.as<string>(),
      edgeUrl: edge.url.as<string>(),
      /**
       * `catalogUrl`, not `storefrontUrl`, and deliberately: the three suites
       * destructure this name and they are the regression surface this port
       * exists to preserve. Renaming an output to match a worker rename is churn
       * with a failure mode and no payoff. It is `tests/workers/Storefront.ts`.
       */
      catalogUrl: storefront.url.as<string>(),
    };
  }),
);
