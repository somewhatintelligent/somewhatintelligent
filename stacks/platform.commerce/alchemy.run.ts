import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import { Layer } from "effect";

import { CommerceModule, StaffPolicy } from "platform.commerce/module";
import * as StripeDev from "platform.commerce/infrastructure/StripeDev";
import { AuthRouting, SiteModule } from "platform.site/module";
import { PRODUCTION_STAGE } from "platform.names";

import { Auth } from "../platform.auth/index.ts";
import { PlatformAccess } from "../platform.access/index.ts";

/**
 * `"PlatformCommerce"` is the state key — state is keyed by stack name and
 * stage, so changing it strands everything the old name owns. It was briefly a
 * shared constant in `platform.names`, because a cross-stack `Worker.ref` named
 * this stack as a string no import graph could check; the site binds these
 * Workers directly now, so the second reader is gone and so is the constant.
 *
 * Drizzle's provider is here for the same reason `platform.auth`'s is: the
 * schema resource generates migrations at deploy time and Cloudflare's provider
 * alone cannot resolve it.
 *
 * IT DEPLOYS THE PUBLIC SITE TOO, and that is why the name is now narrower than
 * the contents. The state key cannot change without stranding a live database,
 * a bucket, a queue and an adopted Access application, so it stays.
 *
 * WHY THE SITE MOVED IN HERE. It binds Commerce and Media, and a binding across
 * a stack boundary only half works: `Worker.ref` reads the target out of the
 * other stack's persisted state, which a deploy has and two `alchemy dev`
 * sessions do not. Deployed, the shop read the catalogue correctly; locally it
 * rendered "catalogue unavailable" on every request, because the site's
 * miniflare had no bridge into the commerce session's registry. One stack is
 * one dev session and one registry — the same reason the operator console could
 * always reach Commerce locally while the site could not.
 *
 * `Auth` still crosses a boundary, and correctly: it publishes an ORIGIN. A URL
 * needs no registry and no bridge, so auth stays its own stack and this one
 * yields its handle.
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
  "PlatformCommerce",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { staffPolicyId } = yield* PlatformAccess.stage[PRODUCTION_STAGE];

    const auth = yield* Auth;

    const commerce = yield* CommerceModule.pipe(
      Effect.provideService(StaffPolicy, { policyId: staffPolicyId }),
      Alchemy.AdoptPolicy.adopt(true),
    );

    /**
     * AFTER the commerce module, so the Workers it binds are already in the
     * graph. `adopt` is deliberately NOT piped here: the site is a stateless
     * Worker whose physical name is stage-derived, so it is a clean create.
     */
    const site = yield* SiteModule.pipe(
      Effect.provideService(AuthRouting, { origin: auth.origin }),
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

    return { ...commerce, site };
  }),
);
