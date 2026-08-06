/**
 * THE CONSOLE'S BOUNDARY, and the only place a caller becomes an actor.
 *
 * Every request resolves a verified `OperatorActor` FIRST and fails closed
 * before any route, loader or server function runs. On success the actor is
 * seeded into the TanStack Start request context, so a server function reads it
 * through `requireOperator` rather than re-verifying the assertion — one
 * verification per request, in one place, which is the only arrangement where
 * "did we check" has a single answer.
 *
 * WHY THIS MATTERS MORE HERE THAN IN A NORMAL APP. Commerce performs NO
 * authorization of its own; it trusts `meta.actor` as already validated by
 * whoever holds its binding. This Worker is whoever. A bug that let an
 * unverified request through would not be a broken login page — it would be
 * unauthenticated write access to the catalogue and the order book.
 */
import startEntry from "@tanstack/react-start/server-entry";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import { observe } from "lib.observability/server";
import { within } from "lib.observability/tanstack-start/server";

import type CommerceWorker from "../workers/Commerce.ts";
import type { OperatorActor } from "../domain/Contracts.ts";
import { resolveOperator } from "./lib/access.server.ts";
import type { OperatorEnv } from "./operator-env.ts";

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: {
        requestId: string;
        actor: OperatorActor;
        paymentsEnvironment: string;
        version: { id: string; tag: string; timestamp: string };
      };
    };
  }
}

/**
 * The console's own image route, and the reason it exists rather than pointing
 * at the public one.
 *
 * `Contracts.mediaHref` spells a media id as the root-relative `/media/<id>`,
 * and the public worker that serves that path joins through
 * `product.status = 'active'` — deliberately, so withdrawing a product kills
 * every image link anyone already had. But publish REFUSES without a cover, and
 * a product cannot be active before it is published, so the entire pre-publish
 * window is exactly when the public route is guaranteed to 404. An operator
 * would be uploading blind.
 *
 * So the console serves the same path from `streamOperatorMedia`, which is
 * binding-only and has no status gate. The public route is untouched.
 *
 * STREAMED, never buffered: the body is handed straight from R2 through
 * Commerce to the response, so a 10 MB photograph never lands in this isolate's
 * memory.
 */
const MEDIA_PREFIX = "/media/";

const serveMedia = async (env: OperatorEnv, mediaId: string): Promise<Response> => {
  const client = toRpcAsync<typeof CommerceWorker>(env.COMMERCE);

  /**
   * BOTH CALLS ANSWER `null` ON A MISS, so either can be the existence check.
   * The content type is asked for first because it costs one indexed row and
   * settles the 404 before an R2 object is opened.
   */
  const contentType = await client.operatorMediaContentType(mediaId);
  if (contentType === null) return new Response("not found", { status: 404 });

  /**
   * A REAL `ReadableStream`. `streamOperatorMedia` deliberately returns the R2
   * body rather than an Effect `Stream` — the latter is framed into an
   * `RpcStreamEnvelope` on its way across the binding and arrives as a stream
   * of the framing, which is a 200 that renders as a broken image. See the
   * method's own note in `workers/CommerceSurface.ts`.
   */
  const body = await client.streamOperatorMedia(mediaId);
  if (body === null) return new Response("not found", { status: 404 });

  return new Response(body, {
    headers: {
      "content-type": contentType,
      /**
       * PRIVATE, unlike the public route's `immutable`. A media id names one
       * set of bytes forever, so the bytes are safe to cache — but this
       * response is behind Access and served to one person, and a shared cache
       * holding it is a copy of an unpublished product sitting outside the
       * gate.
       */
      "cache-control": "private, max-age=300",
    },
  });
};

const handler = async (request: Request, env: OperatorEnv): Promise<Response> => {
  const resolved = await resolveOperator(request, env);
  if (!resolved.ok) {
    /**
     * A misconfiguration is a 500 and a rejection is a 403, and the split is
     * not cosmetic: a 403 reads as "you are not staff" and sends someone to
     * fix their Access membership when the DEPLOY is what is broken.
     */
    const status = resolved.error === "misconfigured" ? 500 : 403;
    if (resolved.error === "misconfigured") {
      console.error("commerce.operator.misconfigured", resolved.message);
    }
    return new Response(resolved.message ?? resolved.error, { status });
  }

  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname.startsWith(MEDIA_PREFIX)) {
    const mediaId = pathname.slice(MEDIA_PREFIX.length);
    // One segment, so a nested path cannot be smuggled into the id.
    if (mediaId !== "" && !mediaId.includes("/")) return serveMedia(env, mediaId);
  }

  return startEntry.fetch(request, {
    context: {
      requestId: crypto.randomUUID(),
      actor: resolved.value,
      paymentsEnvironment: env.PAYMENTS_ENVIRONMENT,
      version: env.CF_VERSION_METADATA,
    },
  });
};

/**
 * `within` is what connects the two halves: it parks the request's span where
 * `app/start.ts`'s middleware can find it, so a server function's span nests
 * under the request rather than starting a trace of its own.
 */
export default {
  fetch: observe(handler, { within }),
} satisfies ExportedHandler<OperatorEnv>;
