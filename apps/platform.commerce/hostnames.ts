/**
 * The hostnames this deploy owns, derived from the stage so two stages can
 * never advertise the same one.
 */
import * as Effect from "effect/Effect";
import { PREVIEW_SCRIPTS, PRODUCTION_ZONE, workerSafeStage, workersDevHost } from "platform.names";

import { Deployment } from "@swi/infra/stage/StandardizedStage";

export const STOREFRONT_ORIGIN = `https://${PRODUCTION_ZONE}`;

/** A developer's storefront, by convention. Only ever right on a laptop. */
export const DEV_STOREFRONT_ORIGIN = "http://localhost:5173";

export const Hostnames = Effect.gen(function* () {
  const { host } = yield* Deployment;
  return { operator: host("commerce"), hooks: host("hooks") };
});

/**
 * Where a hosted checkout returns the buyer, DERIVED FOR EVERY STAGE.
 *
 * WHY THIS IS NOT CONFIGURATION. It used to be `STORE_STOREFRONT_URL`, required
 * on `preprod`, defaulted to localhost on `dev`, and ignored on `prod` — which
 * meant the only environment that derived its own answer was the one whose
 * answer never changes, while the stages whose hostname genuinely varies were
 * made to carry a variable. Nothing ever set it: it had one reader and zero
 * producers, so staging could not deploy and every ephemeral stage silently
 * took the localhost default.
 *
 * Nor could a value have fixed it. `.env.development` is decrypted by dev,
 * every preview stage AND staging, so one file would have had to hold one
 * value for stages that answer on different hostnames by construction.
 *
 * There is nothing to decide. The storefront is `platform.site`, this stack
 * deploys it, and off production its hostname is a pure function of the stage —
 * the same `PREVIEW_SCRIPTS` table the worker is NAMED from, so this cannot
 * drift from what was deployed without a type error. Production answers on the
 * apex, which is a fact about the deployment rather than a setting.
 *
 * NOT READ OFF THE WORKER'S OUTPUT, deliberately: the hostname is known before
 * anything is created, and depending on the resource would order this behind a
 * deploy it does not otherwise need — the same argument the preview comment in
 * `apps/platform.site/alchemy.run.ts` makes for building its URLs this way.
 *
 * Getting this wrong is the one mistake that is silent: every session still
 * opens, every payment still succeeds, and every buyer lands on a dead page
 * afterwards.
 */
export const storefrontOrigin = Effect.gen(function* () {
  const { production, stage, dev: local } = yield* Deployment;
  if (production) return STOREFRONT_ORIGIN;
  if (local) return DEV_STOREFRONT_ORIGIN;
  return `https://${workersDevHost(PREVIEW_SCRIPTS.site(workerSafeStage(stage)))}`;
});
