/* analytics datasets, */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Axiom from "alchemy/Axiom";

import { Effect } from "effect";
import { guardStage } from "./stage/StandardizedStage.ts";
import { APPS, dashboardDocument } from "./observability/dashboards.ts";
import { MONITORS } from "./observability/monitors.ts";

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

/**
 * Where alerts go. Email to start: it needs no third-party webhook to exist
 * before an alert can fire, and a channel that works is worth more than a
 * channel that is elegant. Swap `properties` for `slack`/`pagerduty` later —
 * the monitors reference this by id and do not care which it is.
 */
const alerts = Axiom.Notifier("Alerts", {
  name: "platform-alerts",
  properties: { email: { emails: ["apostoli.geyer@geyerconsulting.com"] } },
});

export default Alchemy.Stack(
  "AxiomStack",
  { state: Cloudflare.state(), providers: Axiom.providers() },
  Effect.gen(function* () {
    yield* guardStage("production");

    /**
     * The datasets must resolve before the dashboards and monitors that query
     * them: an APL query naming a dataset that does not exist yet is a create
     * that fails rather than one that waits.
     */
    const resolved = {
      metrics: yield* metrics,
      traces: yield* traces,
      logs: yield* logs,
      ingest: yield* ingest,
    };

    const notifier = yield* alerts;
    const notifierIds = [notifier.id as unknown as string];

    return {
      ...resolved,
      dashboards: yield* Effect.forEach(APPS, (app) =>
        Axiom.Dashboard(app.id, { dashboard: dashboardDocument(app) }),
      ),
      monitors: yield* Effect.forEach(MONITORS, (monitor) =>
        Axiom.Monitor(monitor.id, monitor.props(notifierIds)),
      ),
    };
  }).pipe(Alchemy.RemovalPolicy.retain(true)),
);
