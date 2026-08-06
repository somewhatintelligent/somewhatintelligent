/* analytics datasets, */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Axiom from "alchemy/Axiom";

import { Effect } from "effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";

import { Deployment, guardStage, type Tier } from "./StandardizedStage.ts";

const metrics = Axiom.Dataset("Metrics", {
  name: "production-metrics",
  kind: "otel:metrics:v1",
});
const traces = Axiom.Dataset("Traces", {
  name: "production-traces",
  kind: "otel:traces:v1",
});
const logs = Axiom.Dataset("Logs", { name: "production-logs", kind: "otel:logs:v1" });

const ingest = Axiom.ApiToken("Ingest", {
  name: "production-ingest",
  datasetCapabilities: {
    "production-traces": { ingest: ["create"] },
    "production-logs": { ingest: ["create"] },
    "production-metrics": { ingest: ["create"] },
  },
});

export default Alchemy.Stack(
  "AxiomStack",
  { state: Cloudflare.state(), providers: Axiom.providers() },
  Effect.gen(function* () {
    yield* guardStage("production");
    return {
      metrics: yield* metrics,
      traces: yield* traces,
      logs: yield* logs,
      ingest: yield* ingest,
    };
  }).pipe(Alchemy.RemovalPolicy.retain(true)),
);

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
 * Telemetry on the tiers that carry real traffic. An ephemeral stage exports
 * nothing, so a sandbox cannot pollute the production datasets.
 *
 * `serviceName` is always passed: unset, alchemy falls back to the physical
 * worker name (`Telemetry.ts:112-120`), which would rename the service in Axiom
 * whenever a worker is renamed. Stage is already a separate `alchemy.stage`
 * attribute, so it does not belong in the name.
 */
export const telemetry = (serviceName: string) => {
  const forTier = Match.type<Tier>().pipe(
    Match.whenOr("production", "staging", () => Telemetry({ serviceName })),
    Match.orElse(() => Layer.empty),
  );
  return Layer.unwrap(Effect.map(Deployment, ({ tier }) => forTier(tier)));
};
