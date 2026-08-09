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

import { CloudflareStack, InternalAccessApplication } from "@swi/infra/cloudflare.stack";
import { Deployment, StageTier, TieredEffect } from "@swi/infra/stage/StandardizedStage";
import { telemetryEnv } from "@swi/infra/observability/telemetry";

import { UNGATED } from "@swi/infra/stage/preview";
import { previewFacts } from "./AuthRouting.ts";

/**
 * The Access application whose assertions a commerce Worker must accept.
 *
 * TWO DIFFERENT APPLICATIONS, not one with a variable name. On production the
 * unit owns a pinned application bound to its own zone hostname, and that `aud`
 * is already live. Off production every unit in the stage sits behind ONE
 * shared application declared by the auth stack, because an Access cookie is
 * scoped to the application that issued it — and a console the operator has to
 * sign into separately from the site that links to it is not a preview anyone
 * will use.
 *
 * IT LIVES HERE, NOT BESIDE THE TAG IN `AuthRouting.ts`, because it is the one
 * piece that needs `@swi/infra/cloudflare.stack` — and that module declares
 * resources at module scope, so anything importing it drags the deploy-time
 * bundler along. `workers/Media.ts` reads the tag and IS a Worker entry, so a
 * shared home for both would put esbuild inside workerd. It did, once; see the
 * note in `AuthRouting.ts`. Nothing that runs in a Worker can reach this file.
 */
const accessFacts = (id: string, domain: string) =>
  TieredEffect({
    production: Effect.gen(function* () {
      const access = yield* InternalAccessApplication(id, domain);
      const {
        organization: { authDomain },
      } = yield* CloudflareStack.stage["production"]!;
      return {
        aud: access.aud.as<string>() as unknown as string,
        teamDomain: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
      };
    }),
    staging: previewFacts,
    ephemeral: previewFacts,
  });

/**
 * Operator console.
 */
export class Operator extends Cloudflare.Website.Vite<Operator>()(
  "CommerceOperator",
  Effect.gen(function* () {
    const { production, stage, dev: local } = yield* Deployment;
    const { operator } = yield* Hostnames;

    /**
     * Resolved only when something will verify against it. Under `alchemy dev`
     * `OPERATOR_AUTH` is `"none"`, `resolveOperator` returns the fixed dev
     * actor without reading either value, and declaring an Access application
     * would put a real account-level resource in front of a hostname this run
     * does not deploy.
     */
    const operatorAuth = local ? "none" : "access";
    const { aud, teamDomain } =
      operatorAuth === "none" ? UNGATED : yield* accessFacts("OperatorAccess", operator);

    return {
      // Through the table, not spelled inline: `preview-access.ts` names this
      // worker's hostname as an Access destination from a stack that never
      // imports this file, and a documentary copy of a name is one that drifts.
      // `PREVIEW_SCRIPTS.operator("prod")` is the string production already
      // carries, so this is not a rename.
      name: PREVIEW_SCRIPTS.operator(production ? "prod" : workerSafeStage(stage)),
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
