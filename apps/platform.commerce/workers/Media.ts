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

import { telemetry } from "@swi/infra/telemetry";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as MediaDomain from "../domain/Media.ts";
import { handles, readCapabilities } from "../runtime.ts";
import { Database } from "../services/Database.ts";

export default class MediaWorker extends Cloudflare.Worker<MediaWorker>()(
  "Media",
  { main: import.meta.url },
  Effect.gen(function* () {
    const resolved = yield* handles;
    const layer = readCapabilities(resolved);

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
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
        telemetry("commerce-media"),
      ),
    ),
  ),
) {}
