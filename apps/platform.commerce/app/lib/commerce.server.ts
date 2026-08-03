/**
 * The two service bindings, typed.
 *
 * `toRpcAsync` recovers the method shapes from the Worker classes themselves,
 * so every call in this app is checked against what `workers/CommerceSurface.ts`
 * and `workers/SettlementSurface.ts` actually implement. That is the whole
 * reason the console lives in this package: the alternative is a hand-written
 * interface restating thirty signatures, which validates nothing and drifts.
 *
 * `typeof CommerceWorker`, not `CommerceWorker` — `Rpc.Shape` unwraps the CLASS
 * VALUE's type (which extends `Effect<Worker & Rpc<Shape>>`). The instance type
 * is not the Effect and recovers nothing.
 *
 * Note what these do NOT wrap: `env.COMMERCE` has no `fetch` worth calling,
 * because Commerce mounts no HTTP surface at all. The binding is the only door.
 */
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";

import type CommerceWorker from "../../workers/Commerce.ts";
import type SettlementWorker from "../../workers/Settlement.ts";

/** The whole domain — catalogue, orders, media, deletion, storefront reads. */
export const commerce = createServerOnlyFn(function commerce() {
  return toRpcAsync<typeof CommerceWorker>(env.COMMERCE);
});

/**
 * The provider relationship: `sweepNow` and `provider`. `settleNow` is
 * deliberately not surfaced by any route — it takes a raw provider event and
 * exists so a test can settle without polling, not so an operator can hand-feed
 * one.
 */
export const settlement = createServerOnlyFn(function settlement() {
  return toRpcAsync<typeof SettlementWorker>(env.SETTLEMENT);
});
