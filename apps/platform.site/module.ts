import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { PRODUCTION_ZONE } from "platform.names";
import { Deployment } from "@swi/infra/stage/StandardizedStage";

import CommerceWorker from "platform.commerce/workers/Commerce";
import MediaWorker from "platform.commerce/workers/Media";

export class AuthRouting extends Context.Service<
  AuthRouting,
  { readonly origin: Output.Output<string> }
>()("platform.site/AuthRouting") {}

/**
 * THE PUBLIC SITE, deployed in the SAME STACK as the commerce substrate it
 * binds — which is why this names those Workers directly instead of resolving
 * them out of another stack.
 *
 * IT USED TO REF THEM ACROSS A STACK BOUNDARY, and that worked in a deploy and
 * only in a deploy. `Worker.ref` reads its target from another stack's
 * persisted state, which a real deployment has; two `alchemy dev` sessions have
 * two dev registries and no way to see into each other, so the site's local
 * miniflare received something that was not a stub and every local request
 * rendered the shop's "catalogue unavailable" plate.
 *
 * Declaring both here puts them in one dev session and one registry — the same
 * reason the operator console could always reach Commerce locally and this
 * could not. It also deletes `binding.ts` entirely: no cast around
 * `Cloudflare.Worker`'s missing `ref` declaration, no `Deployed<W>` helper to
 * recover the shape `InferEnv` needs, and no stack-name string that no import
 * graph can check.
 *
 * THE BARE CLASS, NOT A YIELDED VALUE. The deploy path resolves a class-form
 * declaration itself, so the binding carries the Worker's type without this
 * module having to yield it first.
 */
export class Site extends Cloudflare.Website.Astro<Site>()(
  "Site",
  Effect.gen(function* () {
    const auth = yield* AuthRouting;
    const { production, dev: local } = yield* Deployment;
    const claimsApex = !local && production;
    return {
      ...(production ? { name: "platformcommerce-site-production-rgrpfsan2olmqfri" } : {}),
      rootDir: import.meta.dirname,
      sessionKVBindingName: false,
      compatibility: { date: "2026-04-15", flags: ["nodejs_compat"] },
      ...(claimsApex ? { domain: PRODUCTION_ZONE } : {}),
      workersDev: true,
      env: {
        AUTH_ORIGIN: auth.origin.as<string>(),
        COMMERCE: CommerceWorker,
        MEDIA: MediaWorker,
        PUBLIC_IS_PRODUCTION: production,
      },
    };
  }),
) {}

export type SiteEnv = Cloudflare.InferEnv<Site>;

export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
