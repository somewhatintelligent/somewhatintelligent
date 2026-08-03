import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import { Layer } from "effect";

import { CommerceModule, StaffPolicy } from "platform.commerce/module";
import * as StripeDev from "platform.commerce/infrastructure/StripeDev";
import { COMMERCE_STACK, PRODUCTION_STAGE } from "platform.names";

import { PlatformAccess } from "../platform.access/index.ts";

/**
 * `COMMERCE_STACK` ("PlatformCommerce") is the state key — state is keyed by
 * stack name and stage, so changing it strands everything the old name owns.
 * It is a shared name rather than a literal because `platform.site` names this
 * stack in a `Worker.ref` to bind Commerce, and a ref's target is a string no
 * import graph can check.
 *
 * Drizzle's provider is here for the same reason `platform.auth`'s is: the
 * schema resource generates migrations at deploy time and Cloudflare's provider
 * alone cannot resolve it.
 *
 * No typed handle yet. `Auth` publishes one because a different stack acts on
 * its origin; nothing consumes commerce's outputs from outside, and the thing a
 * consumer will actually want is a SERVICE BINDING, which does not cross a stack
 * boundary. The operator console is exactly that consumer, which is why it is
 * declared inside `apps/platform.commerce` and reaches Commerce by binding
 * rather than over a URL — see `Operator` in `platform.commerce/module`. A
 * storefront lands the same way when it does.
 *
 * `stage[PRODUCTION_STAGE]`, not a bare `yield*`: platform.access is a singleton
 * deployed at prod alone, so every stage of this app pins to that one. The ref
 * lives HERE because `apps/` may not import `stacks/`; the app only states the
 * requirement.
 *
 * No `adopt`. Nothing here exists yet; every physical name is stage-derived, so
 * a `dev_*` deploy stands up its own database, bucket, queue, hostname and
 * Access application rather than touching another stage's. Note the difference
 * from `stacks/mezedes` and `stacks/platform.inbox`, which both adopt because
 * their Access application sits on a hostname that already had one — `desk.`
 * has never been claimed by this account, so a blind create is correct and a
 * collision here would be a real conflict worth failing on.
 */

/**
 * ARMED AT MODULE LOAD, and it has to be here rather than inside the stack body.
 *
 * The Workers read their Stripe secrets with `Config.redacted` during their init
 * phase, and that resolution is what records the Cloudflare secret binding. But
 * `ConfigProvider.fromEnv()` COPIES `process.env` when it is constructed, and
 * alchemy constructs it before it evaluates the stack body — so exporting the
 * secrets from inside the body below would be invisible to every `Config` in the
 * graph, and the whole deployment would silently fall back to the fake payment
 * provider with no error anywhere. Top-level await is the only point reliably
 * earlier than the snapshot.
 *
 * Skipped entirely on a host that carries preprod or prod secrets — see
 * `armIfDevHost`, which owns that condition so this file and the test stack
 * cannot disagree about it.
 */
const stripeArmed = await Effect.runPromise(StripeDev.armIfDevHost());

export default Alchemy.Stack(
  COMMERCE_STACK,
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { staffPolicyId } = yield* PlatformAccess.stage[PRODUCTION_STAGE];

    const commerce = yield* CommerceModule.pipe(
      Effect.provideService(StaffPolicy, { policyId: staffPolicyId }),
    );

    /**
     * The local forwarder, pointed at the address the provider will actually
     * use.
     *
     * `Command.Dev` runs under `alchemy dev` and is a no-op under
     * `alchemy deploy`, which is the correct split: a deployed stage should
     * receive its webhooks from a registered endpoint rather than from someone's
     * laptop. `tests/alchemy.run.ts` deploys, so the suite starts the same
     * command itself against the deployed URL.
     */
    if (stripeArmed && commerce.paymentsEnvironment === "dev") {
      yield* StripeDev.forwarder(commerce.webhookUrl);
    }

    return commerce;
  }),
);
