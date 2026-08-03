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
 * No typed handle, and it turned out not to need one. `Auth` publishes an origin
 * because a different stack acts on it; what a commerce consumer wants is a
 * SERVICE BINDING, and a binding names a script — Cloudflare does not care which
 * stack declared it. `Worker.ref` resolves this stack's `Commerce` out of its
 * persisted state, so a consumer in another stack binds it exactly like a local
 * declaration and no output has to cross.
 *
 * THIS FILE USED TO CLAIM A BINDING CANNOT CROSS A STACK BOUNDARY, and gave that
 * as the reason the operator console lives inside `apps/platform.commerce`. The
 * console does still belong there, but for a better reason: it is this app's own
 * surface. The storefront did NOT land the same way — it is `/shop` on
 * `platform.site`, in its own stack, reaching Commerce by ref. See
 * `apps/platform.site/binding.ts`.
 *
 * `stage[PRODUCTION_STAGE]`, not a bare `yield*`: platform.access is a singleton
 * deployed at prod alone, so every stage of this app pins to that one. The ref
 * lives HERE because `apps/` may not import `stacks/`; the app only states the
 * requirement.
 *
 * `adopt(true)`, and it is here rather than in the app because an adopt policy
 * is composition — the same reason the state layer and the providers are.
 *
 * THIS FILE USED TO SAY THE OPPOSITE, on the grounds that every physical name
 * is stage-derived and `desk.` had never been claimed by this account. The
 * first prod plan disproved the second half:
 *
 *     OwnedBySomeoneElse: Cannot adopt resource 'OperatorAccess'
 *     (Cloudflare.Access.Application): it exists in the cloud but is not
 *     owned by this stack/stage/logical-id.
 *
 * An Access application is identified by its DOMAIN, so one left on `desk.` by
 * an earlier stack is a collision no stage-derived name can avoid — exactly the
 * case `stacks/mezedes` and `stacks/platform.inbox` already adopt for. Note
 * what the alternative would have been: older alchemy planned a blind `create`
 * here, and Cloudflare accepts a SECOND application on the same domain with a
 * fresh `aud`. The gate still stands, but half the tokens fail verification
 * against whichever `aud` `POLICY_AUD` captured, which reads as a broken login
 * rather than a duplicated resource.
 *
 * The rest of the graph is unaffected by the wider policy: the database,
 * bucket, queue and both hostnames are stage-derived and do not exist, so
 * adopting changes nothing for them. It is the Access application, and only
 * the Access application, that this is for.
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
      Alchemy.AdoptPolicy.adopt(true),
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
