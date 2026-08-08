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
 * THE SAME ACCOUNT AS THE STORE. The client comes from `@swi/infra/stripe`,
 * which `platform.commerce` builds its own from — a customer who buys a shirt
 * and a subscription is one Stripe Customer with one payment method, and that is
 * only true while both surfaces read the same key through the same API version.
 * The webhook signing secret is NOT shared and cannot be: Stripe mints one per
 * registered endpoint, and this Worker's endpoint is a different URL.
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
 * resolve. That failure lands on the deploy host, before anything is uploaded,
 * which is the cheapest place for it.
 */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type Stripe from "stripe";

import {
  assertKeyMatchesEnvironment,
  livemodeOf,
  STRIPE_SECRET_KEY,
  stripeClient,
  type StripeEnvironment,
} from "@swi/infra/stripe";

import { tripwire } from "./stand-in.ts";

/**
 * THIS DEPLOYMENT'S endpoint secret, and the reason it is not
 * `STRIPE_WEBHOOK_SIGNING_SECRET`: that name is the store's, bound to the store's
 * endpoint. Sharing the name would give whichever surface deployed second a
 * secret that verifies nothing, and a webhook that fails verification is
 * indistinguishable from one that never arrives — every subscription would stay
 * `incomplete` forever with no error anyone sees.
 */
export const AUTH_WEBHOOK_SECRET_VARIABLE = "STRIPE_AUTH_WEBHOOK_SIGNING_SECRET";

/** Everything that only exists when this deployment actually holds credentials. */
export interface StripeAccount {
  readonly client: Stripe;
  /** Redacted so it cannot reach a log; unwrapped once, at the plugin. */
  readonly webhookSecret: Redacted.Redacted<string>;
  /** Whether this deployment moves real money. Derived from the key's prefix. */
  readonly livemode: boolean;
}

/**
 * ONE OPTION, NOT A RECORD OF SENTINELS. An earlier shape carried `client`,
 * `webhookSecret` and `livemode` unconditionally with a `configured: boolean`
 * beside them — so the type promised every `Billing` had a working `Stripe`, and
 * three of its four fields were lies whenever that flag was false. Nothing
 * stopped the next reader from taking the client and shipping code that
 * typechecks and throws on any stage without a key.
 *
 * `Option` INSIDE the service rather than `Effect.serviceOption(Billing)` around
 * it: an absent CAPABILITY drops the plugin, and a plugin that comes and goes
 * takes the `subscription` table with it — the secret-dependent schema
 * `config.ts` explains at length. The capability is always present; the account
 * is what may be missing.
 */
export class Billing extends Context.Service<
  Billing,
  { readonly account: Option.Option<StripeAccount> }
>()("Auth/Billing") {}

/**
 * A client that refuses.
 *
 * Built at the ONE seam that structurally demands a `Stripe` — the plugin's
 * `stripeClient` option, in `config.ts` — rather than stored on the service,
 * so no other reader can reach for it by accident.
 *
 * A stand-in rather than a client pointed at a placeholder key: an unconfigured
 * stage must make no outbound request at all, and answering `undefined` would
 * let `customers.create` look like it succeeded and returned nothing.
 */
export const refusingClient = (): Stripe =>
  tripwire<Stripe>(
    "Stripe",
    {},
    `This deployment has no ${STRIPE_SECRET_KEY}; billing is off. ` +
      `Set it (and ${AUTH_WEBHOOK_SECRET_VARIABLE}) to enable subscriptions.`,
  );

/**
 * The resolved-but-off state.
 *
 * ONE VALUE FOR BOTH HOSTS, on purpose: `api/inert.ts` and `api/capabilities.ts`
 * must agree about what switched-off looks like, because the schema generator
 * resolves the config through the first and the Worker resolves it through the
 * second. Two definitions would be two chances to differ.
 */
export const unconfigured: Billing["Service"] = Billing.of({ account: Option.none() });

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
 *   key, no endpoint     → die
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
      return unconfigured;
    }

    /**
     * Half a configuration, and it is fatal because nobody sets a live secret
     * key by accident: this means someone intended to sell subscriptions and
     * stopped one step short. Booting anyway would mount a checkout that takes
     * money and a webhook that can never verify the result — the subscription
     * row stays `incomplete`, the customer is charged, and nothing raises.
     */
    if (Option.isNone(webhookSecret)) {
      return yield* Effect.die(
        new Error(
          `${STRIPE_SECRET_KEY} is set but ${AUTH_WEBHOOK_SECRET_VARIABLE} is not. ` +
            `Subscriptions would take payments whose webhooks could never be verified. ` +
            `Set ${AUTH_WEBHOOK_SECRET_VARIABLE}, or unset ${STRIPE_SECRET_KEY} to run this ` +
            `stage with billing off.`,
        ),
      );
    }

    const livemode = livemodeOf(secretKey.value);
    const mismatch = assertKeyMatchesEnvironment(environment, livemode);
    if (mismatch !== null) return yield* Effect.die(new Error(mismatch.detail));

    return Billing.of({
      account: Option.some({
        client: stripeClient(secretKey.value),
        webhookSecret: webhookSecret.value,
        livemode,
      }),
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
