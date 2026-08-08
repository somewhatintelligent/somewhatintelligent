/**
 * The Stripe account the IdP sells subscriptions against.
 *
 * A CAPABILITY, not a module-scope client, for the same reason `Signing` is one:
 * `authConfig` is resolved TWICE — once inside the deployed Worker, and once on
 * the deploy host, where the schema and the feature manifest are generated and
 * no secret exists. A `new Stripe(process.env.…)` at module scope would resolve
 * to `undefined` on the second of those and take the schema generator down with
 * it.
 *
 * THE SAME ACCOUNT AS THE STORE. `STRIPE_SECRET_KEY` is read from
 * `@swi/infra/stripe`, which `platform.commerce` reads too — a customer who buys
 * a shirt and a subscription is one Stripe Customer with one payment method, and
 * that is only true while both surfaces read the same variable. The webhook
 * signing secret is NOT shared and cannot be: Stripe mints one per registered
 * endpoint, and this Worker's endpoint is a different URL from the store's.
 *
 * ─── WHAT AN OPERATOR HAS TO DO ONCE ────────────────────────────────────────
 *
 *  1. In the Stripe dashboard, add a webhook endpoint at
 *     `https://accounts.somewhatintelligent.ca/api/auth/stripe/webhook`
 *     subscribed to `checkout.session.completed`,
 *     `customer.subscription.created`, `customer.subscription.updated` and
 *     `customer.subscription.deleted`.
 *  2. `dotenvx set STRIPE_AUTH_WEBHOOK_SIGNING_SECRET <whsec_…> -f .env.production`
 *     (encryption is public-key, so this needs no private key).
 *  3. Create a Price for each entry in `platform.entitlements`'
 *     `PURCHASABLE_PLANS`, carrying that entry's `lookup_key`. Lookup keys are
 *     mode-independent, so the same key exists in test mode and live mode and
 *     nothing about prices is per-stage configuration.
 *
 * Until (1) and (2) are done, a stage that HAS a Stripe secret key refuses to
 * resolve — see {@link BillingIncomplete}. That failure lands on the deploy
 * host, before anything is uploaded, which is the cheapest place for it.
 */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import Stripe from "stripe";

import {
  assertKeyMatchesEnvironment,
  livemodeOf,
  STRIPE_SECRET_KEY,
  type StripeEnvironment,
} from "@swi/infra/stripe";

/**
 * THIS DEPLOYMENT'S endpoint secret, and the reason it is not
 * `STRIPE_WEBHOOK_SIGNING_SECRET`: that name is the store's, bound to the store's
 * endpoint. Sharing the name would give whichever surface deployed second a
 * secret that verifies nothing, and a webhook that fails verification is
 * indistinguishable from one that never arrives — every subscription would stay
 * `incomplete` forever with no error anyone sees.
 */
export const AUTH_WEBHOOK_SECRET_VARIABLE = "STRIPE_AUTH_WEBHOOK_SIGNING_SECRET";

/** The Stripe API version this code is written against. Pinned, never floating. */
const API_VERSION = "2026-07-29.dahlia";

export class Billing extends Context.Service<
  Billing,
  {
    readonly environment: StripeEnvironment;
    /**
     * Whether this deployment can actually talk to Stripe. `false` is a normal
     * state on a contributor's machine and a deliberate one on a stage that
     * sells nothing — the plugin still mounts (see below), its endpoints simply
     * refuse.
     */
    readonly configured: boolean;
    /** Whether this deployment moves real money. Derived from the key's prefix. */
    readonly livemode: boolean;
    /**
     * The client the plugin is handed. When {@link configured} is `false` this is
     * a stand-in that throws on any use, so an unconfigured stage makes no
     * outbound request at all rather than authenticating with a placeholder.
     */
    readonly client: Stripe;
    /** Redacted so it cannot reach a log; unwrapped once, at the plugin. */
    readonly webhookSecret: Redacted.Redacted<string>;
  }
>()("Auth/Billing") {}

/**
 * A client that refuses.
 *
 * Modelled on `inert.ts`'s tripwire and for the same reason: answering
 * `undefined` would let a call look like it succeeded and returned nothing,
 * which for `customers.create` means a user silently without a Stripe customer.
 * A throw names the variable that is missing.
 */
const refusingClient = (): Stripe =>
  new Proxy(
    (): never => {
      throw new Error(
        `Stripe was called but this deployment has no ${STRIPE_SECRET_KEY}; billing is off.`,
      );
    },
    {
      get: (_target, property): unknown => {
        /**
         * SYMBOLS ANSWER `undefined` RATHER THAN THROWING, and the carve-out is
         * not cosmetic: `Symbol.toPrimitive`, `Symbol.toStringTag` and the
         * inspect symbol are read by `String()`, by a logger formatting an
         * object, and by promise detection. Throwing there turns an incidental
         * `console.log` into a crash whose message names Stripe, which is a
         * worse bug than the one this stand-in exists to report.
         */
        if (typeof property === "symbol") return undefined;
        throw new Error(
          `Stripe.${property} was read but this deployment has no ${STRIPE_SECRET_KEY}. ` +
            `Set it (and ${AUTH_WEBHOOK_SECRET_VARIABLE}) to enable subscriptions.`,
        );
      },
    },
  ) as unknown as Stripe;

/**
 * The resolved-but-off state, shared by the deploy host and by any stage with no
 * Stripe credentials.
 *
 * ONE DEFINITION FOR BOTH, on purpose: `api/inert.ts` and `api/capabilities.ts`
 * must agree about the SHAPE of a Billing that is switched off, because the
 * schema generator resolves the config through the first and the Worker resolves
 * it through the second. Two stand-ins would be two chances to differ.
 */
export const unconfigured = (environment: StripeEnvironment): Billing["Service"] =>
  Billing.of({
    environment,
    configured: false,
    livemode: false,
    client: refusingClient(),
    webhookSecret: Redacted.make(""),
  });

/**
 * A stage that has half a Stripe configuration.
 *
 * Fatal, and distinct from having none: nobody accidentally sets a live secret
 * key, so a key with no endpoint secret means someone intended to sell
 * subscriptions and stopped one step short. Booting anyway would mount a
 * checkout that takes money and a webhook that can never verify the result — the
 * subscription row stays `incomplete`, the customer is charged, and no error is
 * raised anywhere.
 */
export class BillingIncomplete extends Error {
  constructor(readonly missing: string) {
    super(
      `${STRIPE_SECRET_KEY} is set but ${missing} is not. Subscriptions would take payments ` +
        `whose webhooks could never be verified. Set ${missing}, or unset ${STRIPE_SECRET_KEY} ` +
        `to run this stage with billing off.`,
    );
    this.name = "BillingIncomplete";
  }
}

/**
 * Resolve the account. INIT PHASE ONLY.
 *
 * `Config` resolved during a Worker's init is recorded by alchemy as a
 * `secret_text` binding at plan time and read back from that binding at cold
 * start, so both halves of the deployment reach the same verdict. `Config.option`
 * keeps that property while allowing absence: alchemy binds a key only when the
 * plan phase actually found a value, so a stage with no key binds nothing and
 * finds nothing at runtime — the two agree by construction rather than by
 * coincidence.
 *
 * DYING IS RESERVED FOR INCOHERENCE. The store dies whenever its Stripe
 * configuration does not resolve, and that is right for a surface whose entire
 * job is settling payments. This is the IdP: sign-in, passkeys, OAuth and
 * organisation invitations all keep working without Stripe, and taking them down
 * because a subscription price is unset would be a self-inflicted outage. So a
 * missing configuration is a state, and only a WRONG one is fatal:
 *
 *   nothing set          → off, with a warning naming both variables
 *   endpoint secret only → off, with a warning (the key is what enables billing)
 *   key, no endpoint     → die: {@link BillingIncomplete}
 *   key for the wrong    → die: a live key outside production, or a test key on
 *   environment            production, is the mistake nobody may deploy past
 */
export const load = (environment: StripeEnvironment): Effect.Effect<Billing["Service"]> =>
  Effect.gen(function* () {
    const secretKey = yield* Config.option(Config.redacted(STRIPE_SECRET_KEY));
    const webhookSecret = yield* Config.option(Config.redacted(AUTH_WEBHOOK_SECRET_VARIABLE));

    if (Option.isNone(secretKey)) {
      yield* Effect.logWarning(
        `auth: subscriptions are OFF — ${STRIPE_SECRET_KEY} is unset. ` +
          `The plugin is still mounted (the schema must not depend on a secret), ` +
          `so its endpoints exist and refuse.`,
      );
      return unconfigured(environment);
    }

    if (Option.isNone(webhookSecret)) {
      return yield* Effect.die(new BillingIncomplete(AUTH_WEBHOOK_SECRET_VARIABLE));
    }

    const livemode = livemodeOf(secretKey.value);
    const mismatch = assertKeyMatchesEnvironment(environment, livemode);
    if (mismatch !== null) return yield* Effect.die(new Error(mismatch.detail));

    return Billing.of({
      environment,
      configured: true,
      livemode,
      /**
       * `createFetchHttpClient` because Workers have no Node http stack. It is
       * also correct on the `workerd` build, which already defaults to fetch —
       * stating it means the client is right whichever build condition the
       * bundler resolves, and that is not a detail worth leaving to the bundler.
       *
       * No crypto provider is passed: the plugin owns the `constructEventAsync`
       * call and passes none either, so the SDK picks its platform default —
       * SubtleCrypto on the `workerd` build, `node:crypto` on the node build,
       * and `nodejs_compat` is on, so both verify.
       */
      client: new Stripe(Redacted.value(secretKey.value), {
        httpClient: Stripe.createFetchHttpClient(),
        apiVersion: API_VERSION,
      }),
      webhookSecret: webhookSecret.value,
    });
  }).pipe(
    /**
     * `Config.option` turns ABSENCE into `None`, but a value that is present and
     * unreadable still fails — and there is nothing to recover to. A secret that
     * cannot be decoded is the same class of problem as the mismatches above, so
     * it takes the same exit rather than quietly becoming "billing is off".
     */
    Effect.catchCause((cause) =>
      Effect.die(
        new Error(
          `auth: ${STRIPE_SECRET_KEY} or ${AUTH_WEBHOOK_SECRET_VARIABLE} is present but ` +
            `could not be read: ${String(cause)}`,
        ),
      ),
    ),
  );

/** The capability, for the Worker. */
export const layer = (environment: StripeEnvironment): Layer.Layer<Billing> =>
  Layer.effect(Billing, load(environment));
