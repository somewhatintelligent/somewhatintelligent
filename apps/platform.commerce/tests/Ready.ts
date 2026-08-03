/**
 * Wait until a freshly deployed stack actually answers.
 *
 * WHY THIS EXISTS. `deploy` resolving means Cloudflare accepted every resource,
 * NOT that the deployment is routable. A service binding needs a moment to
 * propagate, and during that window `Edge → Commerce` returns Cloudflare's own
 * HTML error page — which a JSON client reports as `Unrecognized token '<'`, a
 * message that points nowhere near the cause.
 *
 * The symptom is distinctive and worth naming: the FIRST run after a fresh
 * deploy fails and the second passes. That is not flakiness to be retried away
 * at the assertion level; it is a real property of deploying to an edge network,
 * and the honest place to absorb it is once, here, before any test runs.
 *
 * The probe is a REAL CALL rather than a health endpoint. `listProducts` crosses
 * the same binding, decodes through the same schema, and reads the same D1 as
 * every test below it — so when it succeeds, the thing the suite depends on is
 * demonstrably working, not merely reported as deployed.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { OperatorRpcs } from "../domain/Rpc.ts";

/** Generous: a cold stack with a new D1 can take tens of seconds to route. */
const ATTEMPTS = 60;

const probeOperator = (edgeUrl: string) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(OperatorRpcs);
    return yield* client.listProducts({ limit: 1 });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: edgeUrl }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    ),
  );

const probeStorefront = (catalogUrl: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(`${catalogUrl}/products`);
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    return (await response.json()) as { products: unknown[] };
  });

/**
 * Block until BOTH public surfaces answer, or give up loudly.
 *
 * Both, because they fail independently: Edge depends on a service binding to
 * Commerce, Catalog on its own D1 and R2 handles. A suite that waits for one and
 * assumes the other is back to failing on its first run.
 */
export const awaitStackReady = <T extends { edgeUrl: string; catalogUrl: string }>(
  urls: T,
): Effect.Effect<T> =>
  Effect.all([probeOperator(urls.edgeUrl), probeStorefront(urls.catalogUrl)], {
    concurrency: 2,
    discard: true,
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("1 second"), times: ATTEMPTS }),
    Effect.tapCause(() =>
      Effect.logError(
        `stack did not become routable within ${ATTEMPTS}s — ` +
          `edge=${urls.edgeUrl} catalog=${urls.catalogUrl}`,
      ),
    ),
    Effect.orDie,
    Effect.as(urls),
  );
