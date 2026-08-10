/**
 * Which Stripe account a deployment talks to, and with what secrets.
 *
 * ONE RULE: the keys are never chosen by the code, only by the stage. Every tier
 * reads the SAME two variable names and gets different values, because the
 * separation lives in the encrypted `.env` file a stage decrypts rather than in
 * the spelling of a variable.
 *
 *   production → `.env.production`. The LIVE account, `livemode` events only.
 *   everything → `.env.development`, one test account shared by local runs,
 *   else         every preview stage and staging. On a laptop `stripe listen`
 *                mints the signing secret at deploy time (see
 *                `infrastructure/StripeDev.ts`), so nothing is checked in.
 *
 * WHAT STOPS A STAGE READING ANOTHER'S KEYS, now that the names are shared: the
 * `livemode` guard below, which derives the mode from the key's own prefix and
 * refuses the deploy when it disagrees with the stage. That check never looked
 * at variable names, so it is unaffected by their collapsing into one pair — and
 * it is the only one of the two mechanisms that was ever load-bearing.
 *
 * The old comment claimed the DISTINCT NAMES were the protection: "reusing one
 * name and swapping its value is how a deploy from the wrong shell charges real
 * cards". That was true of a plain checked-in `.env`. It stops describing this
 * repository, where the values are encrypted at rest and a stage is selected by
 * which file the deploy decrypts — so three names resolving to the same two
 * secrets would be ceremony, and a fourth stage would invite inventing a fifth
 * and sixth name for values that come out of a file regardless.
 *
 * HOW THE SECRET REACHES THE WORKER. `Config` resolved in a Worker's INIT phase
 * is bound by alchemy as a Cloudflare `secret_text` automatically: the value
 * comes from the deploy host's environment at plan time, and the identical
 * `yield*` resolves it from the binding at cold start. That is why nothing here
 * touches `WorkerEnvironment` — reading that service is only legal per-event,
 * and doing it at init is what took the whole stack down twice.
 *
 * `livemode` is derived rather than configured, because it must agree with the
 * key in use — a live key with test-mode gating would settle real charges
 * against fake events, and the inverse would ignore real ones.
 *
 * THE ACCOUNT-LEVEL HALF MOVED OUT, to `@swi/infra/stripe`. The secret key's
 * name, the tier→environment mapping and the livemode guard are shared with
 * `platform.auth`, which sells subscriptions against the SAME Stripe account —
 * and two copies of a rule whose entire job is that both surfaces agree would be
 * the one duplication worth avoiding here. What stayed is what is the store's
 * alone: the endpoint signing secret (Stripe mints one per endpoint, so the
 * store's and the IdP's differ by construction), the storefront return URL, and
 * the goods tax code.
 */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { assertKeyMatchesTier, livemodeOf, STRIPE_SECRET_KEY } from "@swi/infra/stripe";
import type { Tier } from "@swi/infra/stage/StandardizedStage";

/**
 * The two variable names this deployment reads.
 *
 * NOT RE-EXPORTED THROUGH THIS MODULE, and that is deliberate. `STRIPE_SECRET_KEY`
 * is ACCOUNT-level and every call site imports it from `@swi/infra/stripe`
 * directly, so a reader can tell an account-wide rule from a store-local one by
 * where it came from. Behind a facade here it reads as the store's to change —
 * and changing it silently moves the IdP's Stripe account too.
 */
export const VARIABLES = {
  secretKey: STRIPE_SECRET_KEY,
  /**
   * THE STORE'S OWN ENDPOINT SECRET, and it can never be the IdP's. Stripe signs
   * with a secret minted per registered endpoint, so `hooks.…/webhook` and the
   * IdP's `/api/auth/stripe/webhook` verify against different values even though
   * both belong to this one account.
   */
  webhookSecret: "STRIPE_WEBHOOK_SIGNING_SECRET",
} as const;

/**
 * Stripe's tax codes for what this store sells.
 *
 * A tax code is what makes `automatic_tax` correct rather than merely enabled:
 * it decides whether a line is taxable at all, and at what rate, in whichever
 * jurisdiction the buyer turns out to be in. The general tangible-goods code is
 * right for garments in Canada; a store selling something else must change it,
 * which is why it is named and configurable rather than inlined at the call.
 */
const GOODS_TAX_CODE_VARIABLE = "STORE_TAX_CODE_GOODS";
const DEFAULT_GOODS_TAX_CODE = "txcd_99999999";

export class StripeConfig extends Context.Service<
  StripeConfig,
  {
    readonly tier: Tier;
    /** Live secret key, or test/sandbox. Redacted so it never reaches a log. */
    readonly secretKey: Redacted.Redacted<string>;
    /** The endpoint signing secret this deployment verifies against. */
    readonly webhookSecret: Redacted.Redacted<string>;
    /**
     * Whether this deployment settles LIVE events. Derived from the key prefix,
     * not configured, so it cannot disagree with the account in use.
     */
    readonly livemode: boolean;
    /**
     * Where a hosted checkout sends the buyer back to. Origin only — the adapter
     * appends the paths, so a storefront cannot end up with two definitions of
     * its own order page.
     */
    readonly storefrontUrl: string;
    /** Stripe tax code applied to garment line items. */
    readonly goodsTaxCode: string;
  }
>()("platform.commerce/services/StripeConfig") {
  /**
   * Read this environment's secrets. INIT PHASE ONLY.
   *
   * Called from a Worker's outer `Effect.gen`, both halves happen at once: the
   * plan records two `secret_text` bindings, and the deployed Worker resolves
   * the same two names from those bindings at cold start. Yielding these inside
   * `fetch` instead would bind nothing and fail at runtime — the documented
   * footgun, and the reason this is a named function rather than an inline read.
   *
   * Fails with `ConfigError` when a secret is absent. That is a legitimate state
   * for `dev` and a deploy-stopping one everywhere else; the caller decides,
   * because only the caller knows which stage it is.
   *
   * `storefrontUrl` ARRIVES AS AN ARGUMENT rather than being read here, because
   * it is derived from the stage and this function only knows the environment —
   * `dev` covers every ephemeral stage, each on its own hostname. See
   * {@link storefrontOrigin}, and `PaymentsProvider.resolve` for the one caller
   * that supplies it.
   */
  static readonly load = (tier: Tier, storefrontUrl: string) =>
    Effect.gen(function* () {
      const secretKey = yield* Config.redacted(VARIABLES.secretKey);
      const webhookSecret = yield* Config.redacted(VARIABLES.webhookSecret);

      // `sk_live_…` is the only prefix that settles real money.
      const livemode = livemodeOf(secretKey);

      /**
       * The guard that makes the naming scheme load-bearing rather than
       * decorative. Without it a live key pasted into the sandbox slot deploys
       * happily and starts taking real payments on a staging storefront.
       *
       * FATAL HERE, and that is this surface's decision rather than the guard's:
       * a store that cannot settle correctly has nothing left to do. The IdP
       * makes the opposite call with the same check, because it has sign-in to
       * keep serving — see `apps/platform.auth/api/billing.ts`.
       */
      const mismatch = assertKeyMatchesTier(tier, livemode);
      if (mismatch !== null) return yield* mismatch;

      const goodsTaxCode = yield* Config.string(GOODS_TAX_CODE_VARIABLE).pipe(
        Config.withDefault(DEFAULT_GOODS_TAX_CODE),
      );

      return StripeConfig.of({
        tier,
        secretKey,
        webhookSecret,
        livemode,
        storefrontUrl: storefrontUrl.replace(/\/+$/, ""),
        goodsTaxCode,
      });
    });

  /** Hand an already-resolved config to the adapter that needs it. */
  static readonly layerOf = (service: StripeConfig["Service"]) =>
    Layer.succeed(StripeConfig, service);
}
