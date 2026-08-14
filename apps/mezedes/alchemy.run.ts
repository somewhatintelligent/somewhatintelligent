import { telemetryEnv } from "@swi/infra/observability/telemetry";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { accessFacts } from "@swi/infra/cloudflare.stack";
import { state } from "@swi/infra/stage/state";

import type { Env } from "./src/server/env.ts";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import { Path } from "effect/Path";
import { PREVIEW_SCRIPTS, PRODUCTION_ZONE, workerSafeStage, workersDevHost } from "platform.names";
import { Deployment, GateFor, Tiered } from "@swi/infra/stage/StandardizedStage";
import { UNGATED } from "@swi/infra/stage/preview";
import { previewFactsFor } from "platform.auth/alchemy.run";
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
  { providers: Cloudflare.providers(), state: state() },
  Effect.gen(function* () {
    const path = yield* Path;
    const { dev, stage } = yield* Deployment;
    const { apex, artifactSuffix, named } = yield* Hostnames;

    /**
     * The gate this Worker deploys behind — `GateFor`, not a hand-rolled
     * `dev ? ...`: the hand-rolled form forgot `SANDBOX` and would have
     * demanded facts auth never exported. With the gate down nothing verifies,
     * so no facts resolve and no Access application is declared.
     *
     * ON PRODUCTION `accessFacts` adopts the pinned application on the apex;
     * off production it declares NOTHING and reads the stage's shared
     * application out of the auth stack — which is why this stack depends on
     * `platform.auth`, CI deploys auth first, and locally both stacks must run
     * FROM THE SAME DIRECTORY (`infra/stage/state.ts` keys a sandbox's store
     * by `process.cwd()`). The orphan bug is fixed by construction: this stack
     * used to mint an application in every stage, pointed at a hostname the
     * stage did not own, and destroying the stage left it behind.
     */
    const auth = yield* GateFor();
    const { aud, teamDomain } =
      auth === "none"
        ? UNGATED
        : yield* accessFacts("MezedesAccess", apex, PRODUCTION.access, previewFactsFor("mezedes"));

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
      staging: PREVIEW_SCRIPTS.mezedes(workerSafeStage("staging")),
      ephemeral: PREVIEW_SCRIPTS.mezedes(workerSafeStage(stage)),
    });

    /**
     * WHERE THIS SHELL ACTUALLY ANSWERS, which off production is NOT the apex.
     * Only `named` claims `domain: apex`; everything else is `workersDev: true`
     * and lives on the account subdomain.
     *
     * It used to be `https://${apex}` unconditionally, and the damage was quiet:
     * `SHELL_ORIGIN` becomes `frame-ancestors 'self' <origin>` on every artifact
     * response (`src/server/serve.ts`), so a preview served the shell from
     * workers.dev while telling artifacts only the apex was allowed to frame
     * them. The artifact loads and then refuses to render, which reads as a
     * mezedes bug rather than a hostname one.
     */
    const origin = named ? `https://${apex}` : `https://${workersDevHost(name)}`;

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
        AUTH: auth,
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
    /**
     * ARTIFACTS ARE PRODUCTION-ONLY, and saying so is the point. The wildcard
     * `routes` that make `<slug>.${artifactSuffix}` resolve are declared in
     * the `named` branch alone, because a route per stage would have every
     * stage contending for records on the zone — the same reason `Ingress`
     * gives for not claiming a hostname per stage. Reporting an address that
     * nothing serves is worse than reporting none.
     */
    const NO_ARTIFACT_ROUTES = "production only — a preview stage registers no artifact routes";
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
          ...(named
            ? {
                previews: "p--<token>.<artifactZone>, from the shell",
                artifacts: `https://<slug>.${artifactSuffix}`,
              }
            : { previews: NO_ARTIFACT_ROUTES, artifacts: NO_ARTIFACT_ROUTES }),
        };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);
