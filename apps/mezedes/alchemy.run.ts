import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { InternalAccessApplication, CloudflareStack } from "@swi/infra/cloudflare.stack";

import type { Env } from "./src/server/env.ts";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import { Path } from "effect/Path";
import { PRODUCTION_STAGE, PRODUCTION_ZONE } from "platform.names";
import type { Owner as OwnerClass } from "./src/server/entry.ts";

const ARTIFACT_ZONE = "somewhatintelligent.dev";
const COMPATIBILITY_DATE = "2026-07-01";
const DEV_PORT = 8787;

const Hostnames = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;
  const zone = yield* Config.string("MEZEDES_ZONE").pipe(Config.withDefault(PRODUCTION_ZONE));
  const artifactZone = yield* Config.string("MEZEDES_ARTIFACT_ZONE").pipe(
    Config.withDefault(ARTIFACT_ZONE),
  );
  const prod = stage === PRODUCTION_STAGE;
  const suffix = prod ? "" : `-${stage}`;
  return {
    apex: `mezedes${suffix}.${zone}`,
    artifactSuffix: prod ? artifactZone : `a${suffix}.${zone}`,
    named: prod,
  };
}).pipe(Effect.orDie);

const Blobs = Cloudflare.R2.Bucket("Blobs");

const OwnerObject = Cloudflare.DurableObject<OwnerClass>("Owner", { className: "Owner" });

export type { Env };
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const path = yield* Path;
    const dev = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);
    const { apex, artifactSuffix, named } = yield* Hostnames;
    const access = yield* InternalAccessApplication("MezedesAccess", apex);
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
  }),
);
