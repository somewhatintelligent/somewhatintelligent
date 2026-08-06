/* analytics datasets, */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Axiom from "alchemy/Axiom";

import { Effect } from "effect";
import { guardStage } from "./StandardizedStage.ts";

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
