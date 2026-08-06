import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { workerSafeStage } from "platform.names";

import { Hostnames } from "./hostnames.ts";
import { PACKAGE_DIR } from "./paths.ts";
import { CommerceDatabase, CommerceSchema, MediaBucket } from "./runtime.ts";
import { environmentFor, type StripeEnvironment } from "./services/StripeConfig.ts";
import CommerceWorker from "./workers/Commerce.ts";
import MediaWorker from "./workers/Media.ts";
import SettlementWorker from "./workers/Settlement.ts";

import { CloudflareStack, InternalAccessApplication } from "@swi/infra/cloudflare.stack";
import { Deployment, StageTier } from "@swi/infra/StandardizedStage";

/**
 * Operator console.
 */
export class Operator extends Cloudflare.Website.Vite<Operator>()(
  "CommerceOperator",
  Effect.gen(function* () {
    const { production, stage, dev: local } = yield* Deployment;
    const { operator } = yield* Hostnames;
    const access = yield* InternalAccessApplication("OperatorAccess", operator);

    const {
      organization: { authDomain },
    } = yield* CloudflareStack.stage["production"]!;

    return {
      name: `si-commerce-operator-${production ? "prod" : workerSafeStage(stage)}`,
      rootDir: PACKAGE_DIR,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      ...(local ? {} : { domain: operator }),
      workersDev: false,
      observability: { enabled: true },
      env: {
        COMMERCE: CommerceWorker,
        SETTLEMENT: SettlementWorker,
        POLICY_AUD: access.aud.as<string>() as unknown as string,
        TEAM_DOMAIN: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
        OPERATOR_AUTH: local ? "none" : "access",
        PAYMENTS_ENVIRONMENT: environmentFor(yield* StageTier) satisfies StripeEnvironment,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
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
