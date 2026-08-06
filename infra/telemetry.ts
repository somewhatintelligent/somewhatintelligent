/**
 * The telemetry binding layer, deliberately in its own module: importing it
 * must not drag `axiom.stack.ts`'s resource declarations into a Worker bundle,
 * where they evaluate at import time and die with `e.resolve is not a function`.
 * Only `.ref()` appears here, and a ref is lazy.
 */
import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import { layerOtlp } from "alchemy/Telemetry";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { tierOfName, type Tier } from "./StandardizedStage.ts";

const AT = { stack: "AxiomStack", stage: "production" } as const;

export const Telemetry = (options?: { readonly serviceName?: string }) =>
  Axiom.Telemetry({
    token: Axiom.ApiToken.ref("Ingest", AT),
    traces: Axiom.Dataset.ref("Traces", AT),
    logs: Axiom.Dataset.ref("Logs", AT),
    metrics: Axiom.Dataset.ref("Metrics", AT),
    serviceName: options?.serviceName,
  });

/**
 * Telemetry on the tiers that carry real traffic; an ephemeral stage exports
 * nothing, so a sandbox cannot reach the production datasets.
 *
 * The phases need different layers. At DEPLOY the stack is present and the
 * Axiom wrapper resolves its refs into bindings. At RUNTIME there is no stack,
 * and `layerOtlp` ignores its options there and reads the bindings back — so
 * the runtime half needs nothing but the service name.
 *
 * `serviceName` is always passed: unset, alchemy falls back to the physical
 * worker name (`Telemetry.ts:112-120`), so renaming a worker would silently
 * rename the service in Axiom. Stage rides along as `alchemy.stage`.
 */
export const telemetry = (serviceName: string) => {
  const forTier = Match.type<Tier>().pipe(
    Match.whenOr("production", "staging", () => Telemetry({ serviceName })),
    Match.orElse(() => Layer.empty),
  );
  return Layer.unwrap(
    Effect.map(Effect.serviceOption(Alchemy.Stack), (stack) =>
      Option.isNone(stack) ? layerOtlp({ serviceName }) : forTier(tierOfName(stack.value.stage)),
    ),
  );
};
