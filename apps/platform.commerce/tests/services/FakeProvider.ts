/**
 * Stripe if this machine has it, the fake otherwise.
 *
 * THE FALLBACK THAT USED TO LIVE IN `services/PaymentsProvider.ts`. It was gated
 * correctly there — preprod and prod died rather than taking it — but a gated
 * branch still puts `PaymentsFake` in the import graph of every Worker that
 * imports the provider module, which is to say in production's bundle; and its
 * `fake_session` table was re-exported from the schema module to reach
 * drizzle-kit, so it reached the migration set and every production database
 * carried an empty table belonging to a double production cannot run.
 *
 * Living under `tests/` makes that unrepresentable rather than merely
 * discouraged. `module.ts` cannot reach this directory, so no deployed Worker
 * can name the fake, so no deployed bundle contains it and no deployed schema
 * knows about it. The gate is the module boundary, not an `if` someone has to
 * keep correct.
 *
 * WHY THE SUITES STILL NEED IT. `settlement.integ` and `store.integ` are
 * documented as needing a deployment and nothing else — no `stripe login`. They
 * place orders, so they need a provider that can mint and settle sessions.
 * The fake is D1-backed rather than an in-memory Map because Commerce and
 * Settlement are separate isolates and the reconcile sweep's whole job is to
 * interrogate a provider some OTHER process wrote to.
 */
import * as Effect from "effect/Effect";

import { stripeProvider, unconfigured, type Provider } from "../../services/PaymentsProvider.ts";
import type { StripeEnvironment } from "@swi/infra/stripe";
import { StripeConfig } from "../../services/StripeConfig.ts";
import * as PaymentsFake from "./PaymentsFake.ts";

/**
 * Resolve a provider for a TEST deployment. INIT PHASE ONLY — see
 * `StripeConfig.load`, whose `Config` reads are what mint the secret bindings.
 *
 * Tries the real adapter first, so a machine with `stripe login` exercises real
 * signature verification and real sessions. That is deliberate: the suites are
 * more valuable the closer they run to production, and the fake is the floor
 * rather than the target.
 */
export const resolveWithFake = Effect.fn("FakeProvider.resolveWithFake")(function* (
  environment: StripeEnvironment,
) {
  return yield* StripeConfig.load(environment).pipe(
    Effect.map(stripeProvider),
    /**
     * `catchCause` rather than a tag match because both ways of failing mean the
     * same thing here — the secret is missing (`ConfigError`) or it is the wrong
     * one for this stage (`StripeKeyMismatch`).
     */
    Effect.catchCause((cause) =>
      Effect.flatMap(
        Effect.logInfo(`${unconfigured(environment, cause)} Falling back to the fake provider.`),
        (): Effect.Effect<Provider> =>
          Effect.succeed({
            layer: PaymentsFake.layer,
            // The fake mints test-mode events, and the settlement gate must agree.
            livemode: false,
            kind: "fake",
          }),
      ),
    ),
  );
});
