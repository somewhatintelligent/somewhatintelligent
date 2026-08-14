import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PREVIEW_SCRIPTS, workerSafeStage } from "platform.names";

import { Hostnames } from "./hostnames.ts";
import { PACKAGE_DIR } from "./paths.ts";
import { CommerceDatabase, CommerceSchema, MediaBucket } from "./runtime.ts";
import { environmentFor, type StripeEnvironment } from "./services/StripeConfig.ts";
import CommerceWorker from "./workers/Commerce.ts";
import MediaWorker from "./workers/Media.ts";
import SettlementWorker from "./workers/Settlement.ts";

import { accessFacts } from "@swi/infra/cloudflare.stack";
import { Deployment, GateFor, StageTier } from "@swi/infra/stage/StandardizedStage";
import { telemetryEnv } from "@swi/infra/observability/telemetry";

import { UNGATED } from "@swi/infra/stage/preview";
import { previewFacts } from "./AuthRouting.ts";

/**
 * Operator console.
 *
 * This file imports `@swi/infra/cloudflare.stack`, which declares resources at
 * module scope and so drags the deploy-time bundler along — safe HERE because
 * nothing that runs in a Worker can reach this module, and fatal one directory
 * over: `workers/Media.ts` is a Worker ENTRY and once died at startup with
 * esbuild inside workerd for exactly this import. That is why the worker reads
 * the `AuthRouting` tag from `AuthRouting.ts`, which imports no stack.
 */
export class Operator extends Cloudflare.Website.Vite<Operator>()(
  "CommerceOperator",
  Effect.gen(function* () {
    const { production, stage, dev: local } = yield* Deployment;
    const { operator } = yield* Hostnames;

    /**
     * `GateFor` rather than a hand-rolled `local ? ...`: the hand-rolled form
     * forgot `SANDBOX`, so a sandbox deploy resolved `"access"`, demanded
     * facts auth never exported, and died — the exact drift `GateFor` exists
     * to make impossible. Facts resolve only when something will verify them;
     * with the gate down, `resolveOperator` returns the fixed dev actor and
     * never reads either value, and no Access application is declared.
     */
    const operatorAuth = yield* GateFor();
    const { aud, teamDomain } =
      operatorAuth === "none"
        ? UNGATED
        : yield* accessFacts("OperatorAccess", operator, undefined, previewFacts("operator"));

    return {
      // Through the table, not spelled inline: `preview-access.ts` names this
      // worker's hostname as an Access destination from a stack that never
      // imports this file, and a documentary copy of a name is one that drifts.
      // `PREVIEW_SCRIPTS.operator("prod")` is the string production already
      // carries, so this is not a rename.
      name: PREVIEW_SCRIPTS.operator(workerSafeStage(production ? "prod" : stage)),
      rootDir: PACKAGE_DIR,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      ...(local ? {} : { domain: operator }),
      workersDev: false,
      observability: { enabled: true },
      env: {
        COMMERCE: CommerceWorker,
        SETTLEMENT: SettlementWorker,
        POLICY_AUD: aud,
        TEAM_DOMAIN: teamDomain,
        OPERATOR_AUTH: operatorAuth,
        PAYMENTS_ENVIRONMENT: environmentFor(yield* StageTier) satisfies StripeEnvironment,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        /**
         * A `Website.Vite` has no impl Effect for a telemetry Layer to bind
         * onto, so the exporter arrives as env and `observe()` in
         * `app/worker.ts` is what reads it. Empty off production and staging.
         */
        ...(yield* telemetryEnv("commerce-operator")),
      },
    };
  }).pipe(Alchemy.AdoptPolicy.adopt(true), Effect.orDie),
) {}

/** The console worker's runtime env, derived from the bindings above. */
export type OperatorEnv = Cloudflare.Workers.InferEnv<Operator>;

// retained as this deploys with site.. probably all to be rehomed later
export const CommerceModule = Effect.gen(function* () {
  yield* CommerceSchema;
  const database = yield* CommerceDatabase;
  yield* MediaBucket;

  yield* CommerceWorker;

  const settlement = yield* SettlementWorker;
  const media = yield* MediaWorker;
  const operator = yield* Operator;
  const { operator: operatorHost, hooks: hooksHost } = yield* Hostnames;

  return {
    paymentsEnvironment: environmentFor(yield* StageTier) satisfies StripeEnvironment,

    webhookUrl: Output.interpolate`${Output.map(settlement.url, (url: string | undefined) =>
      url === undefined || url === "" ? `https://${hooksHost}` : url.replace(/\/+$/, ""),
    )}/webhook`,

    mediaOrigin: Output.map(media.url, (url: string | undefined) =>
      (url ?? "").replace(/\/+$/, ""),
    ),

    operatorUrl: Output.map(operator.url, (url: string | undefined) =>
      url === undefined || url === "" ? `https://${operatorHost}` : url.replace(/\/+$/, ""),
    ),

    databaseName: database.databaseName,
    databaseId: database.databaseId,
  };
});
