import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PREVIEW_SCRIPTS, PRODUCTION_ZONE, workerSafeStage } from "platform.names";
import { UNGATED } from "@swi/infra/stage/preview";
import { Deployment, GateFor, Tiered } from "@swi/infra/stage/StandardizedStage";

import CommerceWorker from "platform.commerce/workers/Commerce";
import MediaWorker from "platform.commerce/workers/Media";

/**
 * The tag itself moved to `platform.commerce/AuthRouting`, because the operator
 * console and the media Worker need it too and commerce cannot import this
 * module without a cycle. Re-exported here so this module's existing importers
 * — `alchemy.run.ts` among them — did not have to move with it.
 */
import { AuthRouting, previewFacts } from "platform.commerce/AuthRouting";
export { AuthRouting };

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
    const { production, stage, dev: local } = yield* Deployment;
    const claimsApex = !local && production;
    /**
     * PINNED PER STAGE, where it used to be whatever alchemy generated. The
     * stage's Access application has to enumerate this hostname as a
     * destination from inside the AUTH stack, which never sees this Worker —
     * so the name has to be derivable from the stage alone, and
     * `PREVIEW_SCRIPTS` is the table both ends read.
     *
     * Production keeps its frozen physical name. Renaming it would replace the
     * live worker rather than update it.
     */
    const name = yield* Tiered({
      production: "platformcommerce-site-production-rgrpfsan2olmqfri",
      staging: PREVIEW_SCRIPTS.site("staging"),
      ephemeral: PREVIEW_SCRIPTS.site(workerSafeStage(stage)),
    });

    const gate = yield* GateFor({ production: "none" });
    const { aud, teamDomain } = gate === "none" ? UNGATED : yield* previewFacts("platform.site");
    return {
      name,
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
        /**
         * The public storefront. Open in production, gated on every preview,
         * and `src/middleware.ts` is what enforces it.
         *
         * GUARDED WHEN GATED, like every other unit. Passing these through raw
         * made the site the one place where an empty `aud` produced a
         * SUCCESSFUL deploy whose every SSR route then answered 500 — the four
         * other units refuse the deploy instead, which is the failure you can
         * act on.
         */
        GATE: gate,
        POLICY_AUD: aud,
        TEAM_DOMAIN: teamDomain,
      },
    };
  }),
) {}

export type SiteEnv = Cloudflare.InferEnv<Site>;

export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
