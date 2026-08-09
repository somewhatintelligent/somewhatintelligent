import { telemetryEnv } from "@swi/infra/observability/telemetry";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { InternalAccessApplication, CloudflareStack } from "@swi/infra/cloudflare.stack";
import { state } from "@swi/infra/stage/state";

import type { Env } from "./src/server/env.ts";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import { Path } from "effect/Path";
import { PREVIEW_SCRIPTS, PRODUCTION_ZONE, workerSafeStage } from "platform.names";
import { Deployment, Tiered, TieredEffect } from "@swi/infra/stage/StandardizedStage";
import { requirePreview } from "@swi/infra/stage/preview";
import { Auth } from "platform.auth/alchemy.run";
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

const previewFacts = Effect.gen(function* () {
  const { previewAud, previewTeamDomain } = yield* Auth;
  return requirePreview(previewAud, previewTeamDomain, "mezedes");
});

/**
 * The Access application whose assertions this Worker accepts.
 *
 * ON PRODUCTION it declares and owns its own, bound to the apex hostname, with
 * the pinned name the live one already carries.
 *
 * OFF PRODUCTION it declares NOTHING and reads the stage's shared application
 * out of the auth stack. Two things follow. One, the orphan bug is fixed by
 * construction: this stack used to mint an `Access.Application` in every stage
 * — pointed at a hostname the stage did not own — and destroying the stage left
 * it behind. Two, mezedes now depends on `platform.auth`, so CI deploys auth
 * first, and locally both stacks must be run FROM THE SAME DIRECTORY, since
 * `infra/stage/state.ts` keys a sandbox's store by `process.cwd()`.
 */
const AccessFacts = TieredEffect({
  production: Effect.gen(function* () {
    const { apex } = yield* Hostnames;
    const access = yield* InternalAccessApplication("MezedesAccess", apex, PRODUCTION.access);
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

export type { Env };
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: state() },
  Effect.gen(function* () {
    const path = yield* Path;
    const { dev, stage } = yield* Deployment;
    const { apex, artifactSuffix, named } = yield* Hostnames;
    const { aud, teamDomain } = yield* AccessFacts;
    const origin = `https://${apex}`;

    /**
     * PINNED PER STAGE, where non-production used to take whatever alchemy
     * generated. The auth stack has to name this hostname as an Access
     * destination without ever importing this file, so it must be derivable
     * from the stage alone.
     *
     * This RENAMES existing `dev_*` and `pr_*` mezedes workers, so alchemy will
     * replace them on the next deploy of those stages. They are ephemeral by
     * definition; production's frozen name is untouched.
     */
    const name = yield* Tiered({
      production: PRODUCTION.worker,
      staging: PREVIEW_SCRIPTS.mezedes("staging"),
      ephemeral: PREVIEW_SCRIPTS.mezedes(workerSafeStage(stage)),
    });

    const worker = yield* Cloudflare.Worker("Mezedes", {
      name,
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
        POLICY_AUD: aud,
        TEAM_DOMAIN: teamDomain,
        ARTIFACT_SUFFIX: artifactSuffix,
        SHELL_ORIGIN: origin,
        /**
         * The exporter as env, read at runtime by `observe()` in
         * `src/server/entry.ts`. Empty off production and staging.
         */
        ...(yield* telemetryEnv("mezedes")),
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
