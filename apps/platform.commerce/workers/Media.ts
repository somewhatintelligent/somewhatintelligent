/**
 * MEDIA — the DEPLOYED entry. The route itself is in `MediaSurface.ts`, shared
 * with the test stack's twin; what is here is the shape of the deployment.
 *
 * PUBLIC IN PRODUCTION, GATED EVERYWHERE ELSE. Serving product images to anyone
 * who loads a page IS this worker's job, so production is the one tier where
 * `GATE` is off. Every other tier is a preview, and this used to be the hole in
 * one: no `name`, no `workersDev: false`, no gate, so a `pr_41` deploy put a
 * reachable, un-authenticated media endpoint on the internet for the lifetime
 * of the branch.
 *
 * NOTHING EVER POINTS A BROWSER AT THIS WORKER'S OWN HOSTNAME, which is why it
 * is the one gated unit that is NOT a destination of the stage's Access
 * application. `Contracts.mediaHref` is the root-relative `/media/<id>`, so an
 * `<img>` goes to the SITE, and `apps/platform.site/src/pages/media/[id].ts`
 * forwards over the `MEDIA` service binding — a hop that stays inside the
 * account and that Access never sees. That route copies the assertion it was
 * given onto the upstream request; without it this gate 403s every product
 * image on every preview.
 *
 * So the edge never fronts this worker and the check below is the whole gate,
 * not a second opinion. A script hitting the `workers.dev` hostname directly
 * gets a 403 from here rather than a login page — correct for a surface with no
 * UI. See `apps/platform.auth/api/preview-access.ts` for why the destination
 * list is kept to the surfaces a person actually opens.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";
import { PREVIEW_SCRIPTS, workerSafeStage } from "platform.names";

import { UNGATED } from "@swi/infra/stage/preview";
import { Deployment, GateFor, Tiered, type Gate } from "@swi/infra/stage/StandardizedStage";
import { previewFacts } from "../AuthRouting.ts";
import { mediaSurface } from "./MediaSurface.ts";

/**
 * The props, as an Effect — the name and the gate both read the stage, and
 * neither is available where a plain object is written.
 *
 * THE CAST IS A TYPE GAP, NOT A RUNTIME ONE. `Resource()` resolves props with
 * `Effect.isEffect(props) ? yield* props : props`, so an Effect here is
 * resolved before any provider sees it; what is narrow is only the class form's
 * THREE-argument overload, which declares plain `InputProps`. `Settlement.ts`
 * carries the same cast and the longer version of this note.
 *
 * IT ALSO ERASES THE REQUIREMENTS, which matters here in a way it does not
 * there: these props need `AuthRouting`, and the cast means a stack that
 * resolves this Worker without providing it fails at DEPLOY rather than at
 * compile. `CommerceModule` is the only such stack and `platform.site`'s
 * `alchemy.run.ts` provides the service to it; the test stack deliberately
 * declares its own ungated twin instead of resolving this one.
 *
 * DO NOT "FIX" THE CAST BY MOVING THE EFFECT ONTO A FIELD. `Input<T>` admits
 * `Effect<T, any, any>` per field so it type-checks, and several fields are
 * read straight off the raw prop object before resolution — the deploy then
 * dies half-built. Measured, on a prod deploy; see `Settlement.ts`.
 */
const mediaProps = Effect.gen(function* () {
  const { stage } = yield* Deployment;

  /**
   * PRODUCTION KEEPS ITS GENERATED NAME — `undefined` here leaves the prop off
   * entirely, and pinning a new one would replace the live worker rather than
   * update it. Off production the name has to be predictable from the stage
   * alone, because the auth stack enumerates this hostname as an Access
   * destination without ever seeing this file.
   */
  const name = yield* Tiered({
    production: undefined,
    staging: PREVIEW_SCRIPTS.media("staging"),
    ephemeral: PREVIEW_SCRIPTS.media(workerSafeStage(stage)),
  });

  const gate = yield* GateFor({ production: "none" });

  /**
   * `previewFacts` rather than `accessFacts`: media has no zone hostname and no
   * application of its own on production, so the only application it ever
   * verifies against is the stage's shared one. When the gate is off —
   * production, and `alchemy dev` — the two values are never read, so there is
   * nothing to resolve and `AuthRouting` is not required.
   */
  const { aud, teamDomain } = gate === "none" ? UNGATED : yield* previewFacts("media");

  return {
    main: import.meta.url,
    env: {
      ...serviceName("commerce-media"),
      GATE: gate,
      POLICY_AUD: aud,
      TEAM_DOMAIN: teamDomain,
    },
    ...(name === undefined ? {} : { name }),
  };
}) as unknown as {
  main: string;
  name?: string;
  env: {
    OTEL_SERVICE_NAME: string;
    GATE: Gate;
    POLICY_AUD: string;
    TEAM_DOMAIN: string;
  };
};

export default class MediaWorker extends Cloudflare.Worker<MediaWorker>()(
  "Media",
  mediaProps,
  mediaSurface.pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        telemetry(),
      ),
    ),
  ),
) {}
