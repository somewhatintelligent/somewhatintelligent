/**
 * The telemetry binding layer, deliberately in its own module: importing it
 * must not drag `axiom.stack.ts`'s resource declarations into a Worker bundle,
 * where they evaluate at import time and die with `e.resolve is not a function`.
 * Only `.ref()` appears here, and a ref is lazy.
 */
import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Output from "alchemy/Output";
import { layerOtlp } from "alchemy/Telemetry";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { Deployment, tierOfName, type Tier } from "./StandardizedStage.ts";

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

/**
 * The same destinations as env vars, for hosts that cannot take the Layer.
 *
 * A `Website.Vite` has no impl Effect to compose into, and a resource's props
 * are evaluated BEFORE `createRuntimeContext` (`Platform.ts:462-468`) — so a
 * telemetry Layer built in there finds no `RuntimeContext`, binds nothing, and
 * says nothing about it. Env is the only way onto those Workers, and the
 * standard `OTEL_EXPORTER_*` variables are the documented route in
 * (`Axiom/Dataset.ts`), read back by `signalConfig` as an implicit destination.
 *
 * These are inert on their own. `observe()` from `./observe.ts` is what reads
 * them at runtime — binding them onto a handler that isn't wrapped exports
 * nothing, which is the trap this whole pair exists to close.
 */
export interface TelemetryEnv {
  readonly OTEL_SERVICE_NAME: string;
  readonly OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: string | Output.Output<string>;
  readonly OTEL_EXPORTER_OTLP_TRACES_HEADERS: string | Output.Output<Redacted.Redacted<string>>;
  readonly OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: string | Output.Output<string>;
  readonly OTEL_EXPORTER_OTLP_LOGS_HEADERS: string | Output.Output<Redacted.Redacted<string>>;
  readonly OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: string | Output.Output<string>;
  readonly OTEL_EXPORTER_OTLP_METRICS_HEADERS: string | Output.Output<Redacted.Redacted<string>>;
}

/**
 * Off means empty, never absent. Returning `{}` for an ephemeral stage made the
 * host's whole `env` a union of two object shapes, and `InferEnv` maps over
 * that union — every unrelated binding on the Worker degraded to the union of
 * every possible binding type, so `env.POLICY_AUD.trim()` stopped compiling.
 * One shape keeps inference intact, and empty is genuinely inert: `readBound`
 * treats `""` as unset, and `signalConfig` skips a signal whose endpoint is
 * empty, so nothing is configured and nothing exports.
 */
const OFF: TelemetryEnv = {
  OTEL_SERVICE_NAME: "",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: "",
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_LOGS_HEADERS: "",
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: "",
};

export const telemetryEnv = (
  serviceName: string,
): Effect.Effect<TelemetryEnv, never, Alchemy.Stack> =>
  Effect.gen(function* () {
    /**
     * `ALCHEMY_STAGE` is deliberately absent: alchemy binds it on every Worker
     * itself, and adding it here made Cloudflare reject the whole upload with
     * "Binding name 'ALCHEMY_STAGE' already in use". `defaultResource` reads it
     * back regardless, so `alchemy.stage` still lands on every span.
     */
    const { tier } = yield* Deployment;
    if (tier === "ephemeral") return OFF;

    const token = yield* Axiom.ApiToken.ref("Ingest", AT);
    const traces = yield* Axiom.Dataset.ref("Traces", AT);
    const logs = yield* Axiom.Dataset.ref("Logs", AT);
    const metrics = yield* Axiom.Dataset.ref("Metrics", AT);

    /**
     * Per-signal rather than one base header set: the bearer is shared, but
     * `X-Axiom-Dataset` names a different dataset for each signal, and a single
     * `OTEL_EXPORTER_OTLP_HEADERS` would send all three to whichever one it
     * named. `Redacted` is what routes the token through `secret_text` instead
     * of landing it in plain env.
     */
    const headers = (dataset: Axiom.Dataset) =>
      Output.map(Output.all(token.token, dataset.name), ([bearer, name]) =>
        Redacted.make(`Authorization=Bearer ${Redacted.value(bearer)},X-Axiom-Dataset=${name}`),
      );

    return {
      OTEL_SERVICE_NAME: serviceName,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traces.otelTracesEndpoint,
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: headers(traces),
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logs.otelLogsEndpoint,
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: headers(logs),
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metrics.otelMetricsEndpoint,
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: headers(metrics),
    };
  });
