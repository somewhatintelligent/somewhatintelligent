/**
 * Which payment provider a Worker runs on, decided ONCE at init.
 *
 * Two Workers need this — Commerce creates sessions, Settlement verifies and
 * settles them — and they must never disagree, because a session minted by one
 * provider cannot be settled by the other. So the decision lives here rather
 * than being restated in each init closure.
 *
 * THE DECISION IS DEPLOY-TIME AND IT IS SAFE THAT WAY. `StripeConfig.load`
 * resolves `Config` values, which alchemy binds as Cloudflare secrets during the
 * plan and resolves from those bindings at cold start — so init reaches the same
 * verdict on the deploy host and inside the deployed Worker. That is what makes
 * this a plain resolution rather than the `Layer.unwrap` deferral an earlier
 * version needed: nothing here reads a per-event service.
 *
 * THERE IS NO FALLBACK IN THIS FILE, and its absence is the design.
 *
 * The spike resolved Stripe and, on failure, fell back to a D1-backed FAKE
 * provider when the stage mapped to `dev`. The branch was gated correctly —
 * preprod and prod died rather than taking it — but gating a branch is not the
 * same as not having one: `PaymentsFake` was imported here, so it reached the
 * bundle of every Worker that imports this module, including production's. Its
 * `fake_session` table was re-exported from `Domain/Schema.ts` to reach
 * drizzle-kit, so it reached the migration set too, and every production
 * database carried an empty table belonging to a double that production is
 * structurally incapable of running.
 *
 * A test double you must remember to gate is a test double in the deployable.
 * So the fallback moved OUT, to `tests/services/PaymentsFake.ts`, and the
 * Workers that may use it are declared separately in `tests/workers/`. This
 * module now knows one provider. A stage that cannot configure Stripe cannot
 * run — at every stage, dev included.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { storefrontOrigin } from "../hostnames.ts";
import { Database } from "./Database.ts";
import { Ids } from "./Ids.ts";
import { Payments } from "./Payments.ts";
import * as PaymentsStripe from "./PaymentsStripe.ts";
import type { StripeEnvironment } from "@swi/infra/stripe";
import { StripeConfig, VARIABLES } from "./StripeConfig.ts";

export interface Provider {
  /**
   * `Database | Ids` stay in the requirement even though the Stripe adapter
   * needs neither: a test entrypoint supplies a D1-backed double here, and both
   * are already in `capabilities`, so a worker layers this on with
   * `Layer.provideMerge` and nothing else changes either way.
   */
  readonly layer: Layer.Layer<Payments, never, Database | Ids>;
  /** Whether this deployment settles LIVE events. */
  readonly livemode: boolean;
  /** What the deployment actually landed on — asserted by the suite. */
  readonly kind: "stripe" | "fake";
}

/**
 * Build the Stripe provider from an already-loaded configuration.
 *
 * Exported so a test entrypoint can try Stripe first and substitute its own
 * double on failure, without restating how the real one is assembled.
 */
export const stripeProvider = (config: StripeConfig["Service"]): Provider => ({
  layer: Layer.provide(PaymentsStripe.layer, StripeConfig.layerOf(config)),
  livemode: config.livemode,
  kind: "stripe",
});

/**
 * The message a stage gets when its Stripe configuration does not resolve.
 * Shared with the test entrypoints so a dev machine without Stripe is told the
 * same thing whichever worker it hit.
 */
export const unconfigured = (environment: StripeEnvironment, cause: unknown): string => {
  /**
   * NAMES EVERY VARIABLE THAT CAN CAUSE THIS, not two of them. The message used
   * to name the secret key and the endpoint secret alone, so a `ConfigError`
   * from any OTHER read was reported as a missing Stripe secret — a staging
   * deploy that failed on `STORE_STOREFRONT_URL` was read as a missing webhook
   * signing secret, and the cause, which named the real variable, was buried
   * behind the prose that contradicted it. Read the cause first.
   */
  return (
    `${environment} cannot resolve its Stripe configuration ` +
    `(${VARIABLES.secretKey}, ${VARIABLES.webhookSecret}, or the tax code). ` +
    `THE CAUSE NAMES THE VARIABLE — read it before assuming which: ${String(cause)}.`
  );
};

/**
 * Resolve the provider. INIT PHASE ONLY — see `StripeConfig.load`.
 *
 * Returns a plain value rather than a layer-of-a-layer so callers can read
 * `livemode` directly instead of threading an Effect through every handler.
 *
 * DYING HERE FAILS THE DEPLOY — a loud, early, cheap failure. The alternative is
 * a Worker that boots, accepts webhooks it cannot verify, and looks healthy
 * while acking real money into a ledger nobody is watching.
 */
export const resolve = Effect.fn("PaymentsProvider.resolve")(function* (
  environment: StripeEnvironment,
) {
  /**
   * Derived HERE rather than inside `load`, which sees only the environment —
   * and `dev` is every ephemeral stage, each answering on its own hostname.
   * This call site already has the stack in context (its callers yield
   * `StageTier` to compute `environment`), so the stage costs nothing to reach.
   */
  const storefrontUrl = yield* storefrontOrigin;

  return yield* StripeConfig.load(environment, storefrontUrl).pipe(
    Effect.map(stripeProvider),
    /**
     * `catchCause` rather than a tag match because both ways of failing mean the
     * same thing to this decision — the secret is missing (`ConfigError`) or it
     * is the wrong one for this stage (`StripeKeyMismatch`) — and neither is
     * recoverable here.
     */
    Effect.catchCause((cause) =>
      Effect.die(
        new Error(
          `${unconfigured(environment, cause)} ` +
            `Refusing to deploy a payment surface with no payment provider.`,
        ),
      ),
    ),
  );
});
