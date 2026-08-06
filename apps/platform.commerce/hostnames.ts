/**
 * The hostnames this deploy owns, derived from the stage so two stages can
 * never advertise the same one.
 */
import * as Effect from "effect/Effect";
import { PRODUCTION_ZONE } from "platform.names";

import { Deployment } from "@swi/infra/StandardizedStage";

export const STOREFRONT_ORIGIN = `https://${PRODUCTION_ZONE}`;

export const Hostnames = Effect.gen(function* () {
  const { host } = yield* Deployment;
  return { operator: host("commerce"), hooks: host("hooks") };
});
