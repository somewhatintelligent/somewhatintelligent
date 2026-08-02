/**
 * A test fixture, and the only way this suite can address the artifact origin
 * while the Worker runs locally.
 *
 * `entry.ts` decides that a request is an artifact request from
 * `new URL(request.url).hostname`. Under `alchemy dev` that URL is NOT the one
 * the client asked for: every request goes through alchemy's dev proxy
 * (`@distilled.cloud/cloudflare-runtime`'s `WorkerProxy`), which rewrites it to
 * the workerd upstream — `http://127.0.0.1:<port>` — and moves the caller's
 * host to `x-forwarded-host`, which nothing in this product reads. A `Host`
 * header on a request to the dev URL therefore never reaches
 * `parseArtifactHost`: verified, not assumed — with `ARTIFACT_SUFFIX` set to
 * `0.0.1` the dev Worker treats EVERY request as artifact `127`, which is what
 * `127.0.0.1` parses to.
 *
 * A service binding has no such hop. `env.MEZEDES.fetch(new Request(url, …))`
 * dispatches the real `handle()` with the URL this fixture chose: the real
 * hostname match, the real R2 reads, the real headers back. What it does not
 * reproduce is the hop in FRONT of the Worker — Cloudflare's static-asset
 * router, which answers before the script runs on any path that matches an
 * asset. See the note on `runWorkerFirst` in `Stack.ts`; that hop is a deploy
 * fact, and one this suite found a defect in.
 *
 * It forwards one request and adds nothing. The one liberty it takes is
 * reporting a thrown exception as `VANTAGE_THREW` with the stack, because a
 * service binding surfaces an unhandled Worker error as an opaque transport
 * failure, and that would leave a real defect looking like a flake.
 *
 * **The default export is the only export.** workerd validates every export of
 * a Worker's entry module as a handler or a Durable Object class; a stray
 * `export const` fails the whole script with "the provided value is not of type
 * 'function or ExportedHandler'" — and in dev that surfaces only as a dev
 * server that accepts connections and never answers. The shared constants live
 * in `Origin.ts`.
 */

import { TARGET_HEADER, VANTAGE_THREW } from "./Origin.ts";

interface VantageEnv {
  readonly MEZEDES: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: VantageEnv): Promise<Response> {
    const target = request.headers.get(TARGET_HEADER);
    if (target === null) {
      return new Response(`${TARGET_HEADER} is required\n`, { status: 400 });
    }

    const headers = new Headers(request.headers);
    headers.delete(TARGET_HEADER);
    // Left over from the dev proxy's own hop. The forwarded request has to be
    // self-consistent: `serveArtifact` reads the URL, but the MCP handler
    // validates the `Host` header against it and 403s on a mismatch.
    headers.set("host", new URL(target).host);
    headers.delete("x-forwarded-host");
    headers.delete("x-forwarded-proto");

    const method = request.method;
    const forwarded = new Request(target, {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body: await request.arrayBuffer() }),
      redirect: "manual",
    });

    try {
      return await env.MEZEDES.fetch(forwarded);
    } catch (cause) {
      return new Response(`${cause instanceof Error ? cause.stack : String(cause)}\n`, {
        status: VANTAGE_THREW,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
