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
 *
 * THE SIGNING SECRET IS NOT SHARED AND CANNOT BE, which is worth stating flatly
 * because `.env.production` already holds one called `STRIPE_WEBHOOK_SIGNING_
 * SECRET` and it looks like the answer. It is the STORE's: Stripe mints a secret
 * per REGISTERED ENDPOINT, that one belongs to `hooks.…/webhook`, and this
 * Worker answers on a different URL. Reusing it would verify nothing.
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
 * Until (1) and (2) are done, PRODUCTION refuses to resolve — on the deploy
 * host, before anything is uploaded, which is the cheapest place for it. Every
 * other stage boots with checkout working and webhooks unverifiable, because
 * their URLs are per-stage and no checked-in secret could be right for them.
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
import { PRODUCTION_STAGE } from "platform.names";

import { AUTH_BASE_PATH, ingress } from "../shared/ingress.ts";
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

/** Where the plugin mounts its endpoint, and therefore what an operator registers. */
export const WEBHOOK_PATH = `${AUTH_BASE_PATH}/stripe/webhook`;

/**
 * The URL to register in the dashboard, DERIVED rather than written down.
 *
 * From `ingress`, the same function the Worker mounts under, so an instruction
 * telling someone which endpoint to create cannot drift from the route that
 * will actually answer. A typo'd endpoint verifies nothing and reports nothing:
 * every subscription stays `incomplete` and no error surfaces anywhere.
 */
const PRODUCTION_WEBHOOK_URL = `${ingress(PRODUCTION_STAGE, false).origin}${WEBHOOK_PATH}`;

/** Everything that only exists when this deployment actually holds credentials. */
export interface StripeAccount {
  readonly client: Stripe;
  /** Whether this deployment moves real money. Derived from the key's prefix. */
  readonly livemode: boolean;
  /**
   * The endpoint secret, WHEN THIS STAGE HAS A REGISTERED ENDPOINT.
   *
   * Optional because reaching Stripe and verifying Stripe are separate
   * capabilities, and off production only the first is generally available. An
   * endpoint secret belongs to one registered URL: production has a stable one,
   * a preview stage's URL contains its PR number, and staging shares the same
   * encrypted file as every preview. So a checked-in secret can be correct for
   * production and cannot be correct for the rest.
   *
   * `None` means checkout works and webhooks do not — see {@link load}.
   */
  readonly webhookSecret: Option.Option<Redacted.Redacted<string>>;
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
 *   key for the wrong    → die: a live key outside production, or a test key on
 *   environment            production, is the mistake nobody may deploy past
 *   key, no endpoint     → prod dies. Everywhere else: checkout works, the
 *   secret                 webhook route refuses, and a warning says so.
 *
 * THAT LAST ROW USED TO DIE EVERYWHERE, and it was wrong for a reason worth
 * recording. The argument was "nobody sets a secret key by accident, so this
 * means someone stopped one step short" — which is true of production and false
 * of every other stage, where `STRIPE_SECRET_KEY` arrives *inherited* from a
 * checked-in encrypted file that dev, every preview and staging all decrypt.
 * Nobody intended anything by it, and the rule took down every preview deploy.
 *
 * What makes the softer answer safe is a guarantee that already exists one
 * branch above: `assertKeyMatchesEnvironment` fences a live key to the
 * production tier. So a stage reaching this row can only be holding a TEST key,
 * and a checkout opened there cannot move real money. Production keeps the
 * fatal rule, because it is the one stage with a registered endpoint and the one
 * stage where the payment is real.
 */
/**
 * One optional secret, with an unreadable value turned into a defect NAMING IT.
 *
 * SCOPED TO THE READ, not wrapped around the whole resolution, and that is a bug
 * fix rather than a style choice: a trailing `catchCause` over the body caught
 * the deliberate `Effect.die`s below too, so a live key on staging reported
 * "present but could not be read" — a message about the wrong problem, pointing
 * at the wrong variable. `Effect.die` is a defect and `catchCause` sees defects.
 */
const optionalSecret = (name: string) =>
  Config.option(Config.redacted(name)).pipe(
    Effect.catchCause((cause) =>
      Effect.die(new Error(`auth: ${name} is present but could not be read: ${String(cause)}`)),
    ),
  );

export const load = (environment: StripeEnvironment): Effect.Effect<Billing["Service"]> =>
  Effect.gen(function* () {
    const secretKey = yield* optionalSecret(STRIPE_SECRET_KEY);
    const webhookSecret = yield* optionalSecret(AUTH_WEBHOOK_SECRET_VARIABLE);

    if (Option.isNone(secretKey)) {
      yield* Effect.logWarning(
        `auth: subscriptions are OFF — ${STRIPE_SECRET_KEY} is unset. ` +
          `The plugin is still mounted (the schema must not depend on a secret), ` +
          `so its endpoints exist and refuse.`,
      );
      return unconfigured;
    }

    /**
     * CHECKED BEFORE the endpoint secret, and the order matters: a key pointed
     * at the wrong account is the more dangerous mistake, and it is the check
     * that makes the softer branch below safe to take.
     */
    const livemode = livemodeOf(secretKey.value);
    const mismatch = assertKeyMatchesEnvironment(environment, livemode);
    if (mismatch !== null) return yield* Effect.die(new Error(mismatch.detail));

    if (Option.isNone(webhookSecret)) {
      /**
       * Production alone stops here. It is the only stage with a registered
       * endpoint, so a missing secret there really does mean someone set up
       * billing and forgot the webhook — and booting would mount a checkout
       * that takes REAL money and a webhook that can never confirm it: the row
       * stays `incomplete`, the customer is charged, and nothing raises.
       */
      if (environment === "prod") {
        return yield* Effect.die(
          new Error(
            `${STRIPE_SECRET_KEY} is set but ${AUTH_WEBHOOK_SECRET_VARIABLE} is not. ` +
              `Production would take payments whose webhooks could never be verified. ` +
              `Register a webhook endpoint at ${PRODUCTION_WEBHOOK_URL} and ` +
              `\`dotenvx set ${AUTH_WEBHOOK_SECRET_VARIABLE} <whsec_…> -f .env.production\`. ` +
              `Turning billing off instead is NOT available here: ${STRIPE_SECRET_KEY} is the ` +
              `store's too, and platform.commerce refuses to resolve without it.`,
          ),
        );
      }
      yield* Effect.logWarning(
        `auth: ${AUTH_WEBHOOK_SECRET_VARIABLE} is unset on ${environment}. Checkout will open ` +
          `against the test account, but /stripe/webhook cannot verify a signature — so a ` +
          `completed payment will NOT activate a subscription here. Point ` +
          `\`stripe listen\` at this stage, or expect rows to stay incomplete.`,
      );
    }

    return Billing.of({
      account: Option.some({
        client: stripeClient(secretKey.value),
        livemode,
        webhookSecret,
      }),
    });
  });
