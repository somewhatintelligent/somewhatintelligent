/**
 * The hostnames this deploy owns, derived from the stage so two stages can
 * never advertise the same one.
 */
import * as Effect from "effect/Effect";
import {
  PREVIEW_SCRIPTS,
  PRODUCTION_ZONE,
  workerSafeStage,
  workersDevHost,
  type WorkersDevHost,
} from "platform.names";

import { Deployment, type StandardizedStage } from "@swi/infra/stage/StandardizedStage";

export const STOREFRONT_ORIGIN = `https://${PRODUCTION_ZONE}`;

/**
 * Where THIS stage's storefront answers, for the stages that are not production.
 *
 * A THIRD READER OF `PREVIEW_SCRIPTS.site`, and that is the point. The site
 * stack names the worker from that table (`apps/platform.site/module.ts`), the
 * auth stack lists the same hostname as an Access destination
 * (`apps/platform.auth/api/preview-access.ts`), and a hosted checkout has to
 * return the buyer to it. Three consumers, one spelling — the alternative is
 * the fourth being wrong in the one way nobody notices, since every session
 * still opens and every payment still succeeds.
 *
 * `workerSafeStage` rather than the raw stage because that is what the site
 * passes; `staging` survives it unchanged, so the site's literal `staging`
 * branch and its `ephemeral` branch both land here.
 *
 * PRODUCTION IS ABSENT on purpose. It keeps a frozen physical worker name and
 * claims the apex, so its origin is {@link STOREFRONT_ORIGIN} and deriving it
 * from this table would name a workers.dev host it does not answer on. The
 * caller decides that, because only the caller knows the tier — which is why
 * the parameter is the whole {@link StandardizedStage} rather than a type that
 * excludes `production`: the one call site branches on the Stripe environment
 * first, and no signature can carry that proof across the boundary.
 *
 * A BRANDED STAGE, so this cannot be handed a bare string. `workerSafeStage`
 * takes `string` and every stage is one, so without the brand an unvalidated
 * name — a raw `github.head_ref`, a stage that never met `PATTERN` — would
 * produce a plausible origin for a storefront that does not exist.
 */
export type StorefrontOrigin = `https://${WorkersDevHost<`si-site-${string}`>}`;

export const storefrontOriginFor = (stage: StandardizedStage): StorefrontOrigin =>
  `https://${workersDevHost(PREVIEW_SCRIPTS.site(workerSafeStage(stage)))}`;

export const Hostnames = Effect.gen(function* () {
  const { host } = yield* Deployment;
  return { operator: host("commerce"), hooks: host("hooks") };
});
