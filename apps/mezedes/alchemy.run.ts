import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { InternalAccessApplication, CloudflareStack } from "@swi/infra/cloudflare.stack";

import type { Env } from "./src/server/env.ts";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import { Path } from "effect/Path";
import { PRODUCTION_ZONE } from "platform.names";
import { Deployment } from "@swi/infra/StandardizedStage";
import type { Owner as OwnerClass } from "./src/server/entry.ts";

const ARTIFACT_ZONE = "somewhatintelligent.dev";
const COMPATIBILITY_DATE = "2026-07-01";
const DEV_PORT = 8787;

/** What production already runs, frozen from when the stage was `prod`. Pinned so `production` adopts rather than creates. */
const PRODUCTION = {
  worker: "mezedes-mezedes-prod-peuffagbooojfvyf",
  blobs: "mezedes-blobs-prod-zo7v2eqbkz5uc2lp",
  access: "Mezedes-MezedesAccess-prod-u4tujiyz2oidprqf",
} as const;

const Hostnames = Effect.gen(function* () {
  const { production, suffix, host } = yield* Deployment;
  const zone = yield* Config.string("MEZEDES_ZONE").pipe(Config.withDefault(PRODUCTION_ZONE));
  const artifactZone = yield* Config.string("MEZEDES_ARTIFACT_ZONE").pipe(
    Config.withDefault(ARTIFACT_ZONE),
  );
  return {
    apex: host("mezedes", zone),
    artifactSuffix: production ? artifactZone : `a${suffix}.${zone}`,
    named: production,
  };
}).pipe(Effect.orDie);

const Blobs = Cloudflare.R2.Bucket(
  "Blobs",
  Effect.map(Deployment, (d) => (d.production ? { name: PRODUCTION.blobs } : {})),
).pipe(Alchemy.RemovalPolicy.retain(Effect.map(Deployment, (d) => d.production)));

const OwnerObject = Cloudflare.DurableObject<OwnerClass>("Owner", { className: "Owner" });

export type { Env };
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const path = yield* Path;
    const { dev } = yield* Deployment;
    const { apex, artifactSuffix, named } = yield* Hostnames;
    const access = yield* InternalAccessApplication(
      "MezedesAccess",
      apex,
      named ? PRODUCTION.access : undefined,
    );
    const origin = `https://${apex}`;
    const {
      organization: { authDomain },
    } = yield* CloudflareStack.stage["production"]!;

    const worker = yield* Cloudflare.Worker("Mezedes", {
      main: path.resolve(import.meta.dirname, "src/server/entry.ts"),
      observability: { enabled: true },
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      dev: { port: DEV_PORT, strictPort: true },
      ...(named
        ? {
            name: PRODUCTION.worker,
            domain: apex,
            routes: [{ pattern: `*.${artifactSuffix}/*`, zoneName: artifactSuffix }],
          }
        : {}),
      workersDev: !named,
      assets: {
        directory: path.resolve(import.meta.dirname, "dist/shell"),
        notFoundHandling: "single-page-application",
        runWorkerFirst: true,
      },
      env: {
        BLOBS: Blobs,
        OWNER: OwnerObject,
        LOADER: Cloudflare.WorkerLoader("LOADER"),
        AUTH: dev ? "none" : "access",
        POLICY_AUD: access.aud.as<string>(),
        TEAM_DOMAIN: Output.interpolate`https://${authDomain}`.as<string>(),
        ARTIFACT_SUFFIX: artifactSuffix,
        SHELL_ORIGIN: origin,
      },
    });
    return dev
      ? {
          shell: worker.url.as<string>(),
          mcp: Output.interpolate`${worker.url}mcp`,
          artifacts: "not reachable by hostname under `alchemy dev` — deploy to see them",
          previews: "likewise: a preview is its own origin, which the dev proxy rewrites away",
        }
      : {
          shell: origin,
          mcp: `${origin}/mcp`,
          previews: "p--<token>.<artifactZone>, from the shell",
          artifacts: `https://<slug>.${artifactSuffix}`,
        };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);
