/**
 * MEDIA — product images, and nothing else. The surface, shared by both
 * entries.
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
 * WHY THE FILE EXISTS AT ALL, rather than the impl living in `Media.ts`: the
 * deployed entry is GATED off production and the test stack's twin is not, and
 * the two differ in nothing else. Same split, and the same reason, as
 * `SettlementSurface.ts` — a green suite is evidence about the code that ships
 * rather than a parallel copy of it.
 *
 * Lifted verbatim from the spike's `Catalog.ts` media route. The rest of that
 * worker — the storefront reads and the anonymous `placeOrder` — lives in
 * `tests/workers/Storefront.ts`, because it is an unauthenticated write path
 * and this package does not deploy one.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { refusal, verifyAccess } from "lib.access-jwt";

import * as MediaDomain from "../domain/Media.ts";
import { handles, readCapabilities } from "../runtime.ts";
import { Database } from "../services/Database.ts";

export const mediaSurface = Effect.gen(function* () {
  const resolved = yield* handles;
  const layer = readCapabilities(resolved);

  return {
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      /**
       * THE PREVIEW GATE, before the route and before the database.
       *
       * `GATE` is absent from the test stack's twin and `"none"` on production
       * and under `alchemy dev`, so this costs a property read on the paths
       * where the worker is meant to be public.
       *
       * The storefront reaches this over a SERVICE BINDING, which Access never
       * fronts — `apps/platform.site/src/pages/media/[id].ts` forwards the
       * assertion it was given so that this check has something to verify.
       *
       * `WorkerEnvironment` is read HERE rather than in the init Effect above:
       * reading it per-event is legal and reading it at init is what took the
       * whole stack down twice — `services/StripeConfig.ts` carries the long
       * version of that note.
       *
       * `verifyAccess` reads exactly one header, so a `Request` built from this
       * one's headers carries everything it needs; `toWeb` would consume the
       * body stream and can fail, for nothing gained.
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
});
