/**
 * MEDIA — product images, and nothing else.
 *
 * THE ONLY READ-ONLY PUBLIC SURFACE THIS PACKAGE DEPLOYS. One route, one verb:
 * `GET /media/:id`. There is no write path here to leave unauthenticated,
 * because there is no write path at all — the bucket handle is used for `get`
 * and the router refuses every other method before it reaches a database.
 *
 * WHY IT IS DEPLOYED WHEN THE STOREFRONT IS NOT. `Contracts.mediaHref` spells a
 * media id as the root-relative `/media/<id>`, so the address is part of the
 * data a product carries rather than a choice a consumer makes. A storefront
 * binding Commerce gets product rows with those hrefs in them and needs
 * something to serve them; without this worker every image on every page is a
 * 404, and the substrate would not be usable by the app it exists for.
 *
 * WHY IT STREAMS RATHER THAN REDIRECTS. The R2 key never leaves the system and
 * access stays revocable — `openMedia` joins through `product.status = 'active'`,
 * so an archived product's images stop being served the moment it is archived.
 * A public bucket URL would keep answering forever.
 *
 * Lifted verbatim from the spike's `Catalog.ts` media route. The rest of that
 * worker — the storefront reads and the anonymous `placeOrder` — lives in
 * `tests/workers/Storefront.ts`, because it is an unauthenticated write path
 * and this package does not deploy one.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { refusal, verifyAccess } from "lib.access-jwt";
import { PREVIEW_SCRIPTS, workerSafeStage } from "platform.names";

import { Deployment, GateFor, Tiered } from "@swi/infra/stage/StandardizedStage";
import { previewFacts } from "../AuthRouting.ts";
import * as MediaDomain from "../domain/Media.ts";
import { handles, readCapabilities } from "../runtime.ts";
import { Database } from "../services/Database.ts";

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
 * DO NOT "FIX" THIS BY MOVING THE EFFECT ONTO A FIELD. `Input<T>` admits
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

  /**
   * PUBLIC IN PRODUCTION, and that is the point of this worker: it serves the
   * storefront's product images to anyone who loads a page. On a preview it is
   * behind the stage's Access application like everything else — which works
   * for `<img>` subresources only because that application is SHARED with the
   * site pulling them.
   */
  const gate = yield* GateFor({ production: "none" });
  /**
   * `previewFacts` directly rather than `accessFacts`: media has no zone
   * hostname and no application of its own on production, so the only
   * application it ever verifies against is the stage's shared one. When the
   * gate is off — production, and `alchemy dev` — the two values are never
   * read, so there is nothing to resolve.
   */
  const { aud, teamDomain } = gate === "none" ? { aud: "", teamDomain: "" } : yield* previewFacts;

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
    GATE: "access" | "none";
    POLICY_AUD: string;
    TEAM_DOMAIN: string;
  };
};

export default class MediaWorker extends Cloudflare.Worker<MediaWorker>()(
  "Media",
  mediaProps,
  Effect.gen(function* () {
    const resolved = yield* handles;
    const layer = readCapabilities(resolved);

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        /**
         * THE PREVIEW GATE, before the route and before the database.
         *
         * `WorkerEnvironment` is read HERE rather than in the init Effect
         * above: reading it per-event is legal and reading it at init is what
         * took the whole stack down twice — `services/StripeConfig.ts` carries
         * the long version of that note.
         *
         * `verifyAccess` reads exactly one header, so a `Request` built from
         * this one's headers carries everything it needs; `toWeb` would consume
         * the body stream and can fail, for nothing gained.
         */
        const env = yield* Cloudflare.Workers.WorkerEnvironment;
        if (env["GATE"] === "access") {
          const verdict = yield* Effect.promise(() =>
            verifyAccess(new Request("https://media.internal/", { headers: request.headers }), {
              POLICY_AUD: typeof env["POLICY_AUD"] === "string" ? env["POLICY_AUD"] : undefined,
              TEAM_DOMAIN: typeof env["TEAM_DOMAIN"] === "string" ? env["TEAM_DOMAIN"] : undefined,
            }),
          );
          if (!verdict.ok) return HttpServerResponse.fromWeb(refusal(verdict));
        }

        const path = new URL(request.url, "http://media").pathname;
        const segments = path.split("/").filter(Boolean);

        if (request.method !== "GET" || segments[0] !== "media" || segments.length !== 2) {
          return yield* HttpServerResponse.json({ error: "not_found" }, { status: 404 });
        }

        const database = yield* Database;
        const blob = yield* MediaDomain.openMedia(database.db, segments[1] as string);
        if (!blob) return yield* HttpServerResponse.json({ error: "not_found" }, { status: 404 });

        const bytes = Stream.fromReadableStream({
          evaluate: () => blob.body,
          onError: (error) => error,
        });

        return HttpServerResponse.stream(bytes, {
          headers: {
            "content-type": blob.contentType,
            // Immutable: a media id names exactly one set of bytes forever.
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }).pipe(
        Effect.provide(layer),
        /**
         * LOGGED, NOT RETURNED. `query` wraps D1 in `Effect.promise`, so a
         * database failure arrives here as a defect whose message is the raw
         * driver text — table and column names included. That is free
         * reconnaissance for an anonymous caller and tells a legitimate one
         * nothing they can act on.
         */
        Effect.catchCause((cause) =>
          Effect.flatMap(Effect.logError("commerce.media.failed", cause), () =>
            HttpServerResponse.json({ error: "internal" }, { status: 500 }),
          ),
        ),
      ),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        telemetry(),
      ),
    ),
  ),
) {}
