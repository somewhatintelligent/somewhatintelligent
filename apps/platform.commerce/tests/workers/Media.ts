/**
 * MEDIA — the TEST TWIN, and the only difference from the deployed entry is
 * that this one has no gate.
 *
 * DELIBERATELY UNGATED, for the same reason `Edge.ts` and `Storefront.ts` exist
 * at all: a test process is not a Worker, holds no service binding, has no
 * browser and has no Access cookie, so the only way it reaches a deployed stack
 * is over plain HTTP. `store.integ.test.ts` case H fetches
 * `${catalogUrl}/media/<id>` and asserts the PNG bytes round-trip; behind
 * Access that request is a 403 and the assertion is about the login page.
 *
 * IT IS NOT A HOLE IN THE PREVIEW REGIME. This is the `PlatformCommerceTests`
 * stack — a different stack name, therefore a different state key — deployed to
 * a throwaway stage by `bun run test:integ` and destroyed by its teardown.
 * Nothing in the preview workflow deploys it: `.github/actions/alchemy` names
 * four `alchemy.run.ts` entrypoints and this package's is not among them.
 *
 * The surface is the SAME MODULE the deployed worker runs, so a green suite is
 * evidence about the code that ships. Same split, same reason, as
 * `tests/workers/Settlement.ts`.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";

import { mediaSurface } from "../../workers/MediaSurface.ts";

export default class TestMediaWorker extends Cloudflare.Worker<TestMediaWorker>()(
  "Media",
  // No `GATE`, so `mediaSurface` never reaches its verifier.
  { main: import.meta.url, env: serviceName("commerce-media") },
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
