/**
 * Which Stripe account a deployment talks to, and with what secrets.
 *
 * THREE ENVIRONMENTS, ONE RULE: the keys are never chosen by the code, only by
 * the stage. Every environment reads the SAME two variable names and gets
 * different values, because the separation lives in the encrypted `.env` file a
 * stage decrypts rather than in the spelling of a variable.
 *
 *   dev       → `.env.development`. `stripe listen` on the developer's machine
 *               mints the signing secret and exports it at deploy time (see
 *               `Infrastructure/StripeDev.ts`), so nothing is checked in.
 *   preprod   → the SANDBOX account. Test-mode keys, sandbox webhook endpoint.
 *               Safe to point a staging storefront at.
 *   prod      → `.env.production`. The LIVE account, and `livemode` events only.
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
 */
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { Deployment, type Tier } from "@swi/infra/stage/StandardizedStage";

import { STOREFRONT_ORIGIN, storefrontOriginFor } from "../hostnames.ts";
import * as Schema from "effect/Schema";

export type StripeEnvironment = "dev" | "preprod" | "prod";

/**
 * The two variable names every environment reads, matching the keys written in
 * `.env.development` and `.env.production`.
 *
 * Flat rather than keyed by environment: three entries resolving to identical
 * strings would read as a distinction the system no longer makes, and the next
 * person to add a stage would dutifully invent a fourth name for a value that
 * comes out of a file selected by dotenvx anyway.
 */
export const VARIABLES = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SIGNING_SECRET",
} as const;

/** A developer's storefront, by convention. Only under `alchemy dev`. */
const DEV_STOREFRONT_URL = "http://localhost:5173";

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

/**
 * A key that does not match the environment asking for it.
 *
 * Separate from a missing key on purpose: absent secrets are a normal state on a
 * contributor's machine, but a live key in a preprod slot is a mistake nobody
 * should be allowed to deploy past.
 */
class StripeKeyMismatch extends Schema.TaggedErrorClass<StripeKeyMismatch>()("StripeKeyMismatch", {
  environment: Schema.String,
  detail: Schema.String,
}) {}

/**
 * Map a deploy TIER onto a Stripe environment.
 *
 * A tier, not a raw stage string, and that is the whole point: `Tier` is decoded
 * from a validated {@link StandardizedStage}, so the set of inputs is closed and
 * the mapping is total. The previous version matched `stage === "prod"` — a
 * string that is not a legal stage under the standard at all — which meant a
 * typo'd or invented stage name fell through to `dev` while a deliberately
 * crafted one could claim `prod` and load a live key.
 *
 * Read with `environmentFor(yield* StageTier)`, which validates the stage on the
 * way past. Combined with the `livemode` guard below, LIVE KEYS ARE REACHABLE
 * ONLY FROM THE `production` TIER: a live key resolved anywhere else refuses to
 * deploy, and a test key on production does too.
 */
export const environmentFor = (tier: Tier): StripeEnvironment =>
  tier === "production" ? "prod" : tier === "staging" ? "preprod" : "dev";

export class StripeConfig extends Context.Service<
  StripeConfig,
  {
    readonly environment: StripeEnvironment;
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
   */
  static readonly load = (environment: StripeEnvironment) =>
    Effect.gen(function* () {
      const secretKey = yield* Config.redacted(VARIABLES.secretKey);
      const webhookSecret = yield* Config.redacted(VARIABLES.webhookSecret);

      /**
       * A hosted checkout REFUSES to open without somewhere to return the buyer
       * to, so this is not optional configuration — it is the difference between
       * a working Buy button and `Missing required param: success_url`.
       *
       * EVERY STAGE DERIVES IT AND NONE CAN BE TOLD OTHERWISE. The stack that
       * resolves this config is the stack that deploys the storefront, so the
       * origin is a fact about the deployment rather than a setting. Production
       * already worked this way; the rest read `STORE_STOREFRONT_URL`, and that
       * was the one variable whose being wrong is silent — every session still
       * opens, every payment still succeeds, and every buyer is returned to a
       * dead page afterwards.
       *
       * It was also the one variable NOTHING PROVIDED. Production derived, an
       * ephemeral stage resolved to `dev` and defaulted to localhost, and only
       * `preprod` reached the bare `Config.string` — so staging asked for a
       * value absent from both `.env` files and died at
       * `PaymentsProvider.resolve`, in the one tier no preview exercises.
       *
       * `dev` IS NOW THE LOCAL WORKERD, NOT A TIER. `environmentFor` maps every
       * ephemeral stage to the `dev` Stripe environment, so keying the localhost
       * guess off that name pointed a DEPLOYED preview's buyers at the
       * developer's own machine. `Deployment.dev` is the narrower question — is
       * a workerd serving this here — and it is the only one localhost answers.
       */
      const { stage, dev: local } = yield* Deployment;
      const storefrontUrl =
        environment === "prod"
          ? STOREFRONT_ORIGIN
          : local
            ? DEV_STOREFRONT_URL
            : storefrontOriginFor(stage);

      // `sk_live_…` is the only prefix that settles real money.
      const livemode = Redacted.value(secretKey).startsWith("sk_live_");

      /**
       * The guard that makes the naming scheme load-bearing rather than
       * decorative. Without it a live key pasted into the sandbox slot deploys
       * happily and starts taking real payments on a staging storefront.
       */
      if (environment === "prod" && !livemode) {
        return yield* new StripeKeyMismatch({
          environment,
          detail: `${VARIABLES.secretKey} does not hold a live key; prod must not run on test keys`,
        });
      }
      if (environment !== "prod" && livemode) {
        return yield* new StripeKeyMismatch({
          environment,
          detail: `${VARIABLES.secretKey} holds a LIVE key; ${environment} must use a test key`,
        });
      }

      const goodsTaxCode = yield* Config.string(GOODS_TAX_CODE_VARIABLE).pipe(
        Config.withDefault(DEFAULT_GOODS_TAX_CODE),
      );

      return StripeConfig.of({
        environment,
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
