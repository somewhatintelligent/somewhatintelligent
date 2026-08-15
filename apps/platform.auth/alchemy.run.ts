import * as Alchemy from "alchemy";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Providers";
import * as Output from "alchemy/Output";
import { state } from "@swi/infra/stage/state";
import { Effect, Layer } from "effect";

import { AvatarBucket } from "./api/avatars.ts";
import { AuthDatabase, PRODUCTION_DATABASE_ID, PRODUCTION_DATABASE_NAME } from "./api/database.ts";
import { authFeatures } from "./api/options.ts";
import { PreviewAccessApp } from "./api/preview-access.ts";
import AuthWorker from "./api/worker.ts";
import { PRODUCTION_STAGE } from "platform.names";
import { DEV_PORT, ingress } from "./shared/ingress.ts";
import { authDefines } from "./shared/surfaces.ts";

import { AuthSchema } from "./api/schema.ts";
import * as StripeDev from "./infrastructure/StripeDev.ts";
import { requirePreview, UNGATED } from "@swi/infra/stage/preview";
import { GateFor } from "@swi/infra/stage/StandardizedStage";
import { telemetryEnv } from "@swi/infra/observability/telemetry";
import * as Option from "effect/Option";

import type { AuthFeatures } from "lib.better-auth-manifest";

/**
 * AT MODULE LOAD, and it has to be: alchemy snapshots `process.env` into its
 * `ConfigProvider` before the stack body runs, so a secret exported from inside
 * the body is invisible to every `Config` in the graph — including the one in
 * `api/billing.ts` that records the Worker's binding.
 */
const stripeArmed = await Effect.runPromise(StripeDev.armIfDev());

interface AuthRouting {
  readonly origin: string;
  readonly authBaseURL: string;
  readonly cookieDomain: string | null;
  readonly features: AuthFeatures;
  readonly databaseId: string;
  /**
   * The stage's shared Access application.
   *
   * EXPORTED BECAUSE FOUR OTHER STACKS NEED IT. Auth is the only stack that
   * declares the application, and mezedes, the commerce console, media and the
   * site all verify assertions it minted — which needs its `aud`. These outputs
   * are how they get it, and `yield* Auth` is why CI deploys auth first.
   *
   * BOTH EMPTY ON PRODUCTION, where there is no shared application and every
   * unit reads the `aud` of its own. Empty rather than absent because a
   * nullable stack output cannot be branched on — see `infra/stage/preview.ts`,
   * which is also where a consumer's guard against reading them lives.
   */
  readonly previewAud: string;
  readonly previewTeamDomain: string;
}

class Identity extends Cloudflare.Website.Vite<Identity>()(
  "SomewhatIntelligentAuthApp",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);
    const { name, hostname } = ingress(stage, local);
    /**
     * The same memoised resource the stack body yields, not a second one.
     * `None` on production, where this surface is public and the gate below
     * resolves to `"none"` anyway.
     */
    const preview = yield* PreviewAccessApp;
    return {
      name,
      rootDir: import.meta.dirname,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        AUTH: AuthWorker,
        AVATARS: yield* AvatarBucket,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        /**
         * PRODUCTION AUTH IS PUBLIC — it is where a customer signs in, so it
         * is the one surface that must stay reachable without already being
         * signed in to something else. Every other tier is a preview nobody
         * outside the account should reach, gate included.
         */
        GATE: yield* GateFor({ production: "none" }),
        // `UNGATED` is the named empty — the same sentinel `requirePreview`
        // guards against — so producer and guard cannot drift silently.
        POLICY_AUD: Option.getOrElse(preview, () => UNGATED).aud,
        TEAM_DOMAIN: Option.getOrElse(preview, () => UNGATED).teamDomain,
        ...authDefines(yield* authFeatures),
        /**
         * A `Website.Vite` has no impl Effect for a telemetry Layer to bind
         * onto, so the exporter arrives as env and `observe()` in
         * `app/worker.ts` is what reads it. Empty off production and staging.
         */
        ...(yield* telemetryEnv("auth-app")),
      },
      dev: { port: DEV_PORT, strictPort: true },
      ...(hostname === null ? {} : { domain: hostname }),
      workersDev: hostname === null,
    };
  }),
) {}

export type IdentityEnv = Cloudflare.Workers.InferEnv<Identity>;

export class Auth extends Alchemy.Stack<Auth, AuthRouting>()("SomewhatIntelligentAuth") {}

/**
 * The stage's shared Access facts, read out of this stack's persisted output
 * and REFUSED if empty — for the sibling stacks (mezedes, the inbox) that
 * reach auth across the stack boundary. Their two byte-identical copies of
 * this destructure-and-guard are what this replaces; commerce cannot use it,
 * because inside its graph the same facts arrive through the `AuthRouting`
 * service rather than a stack reference.
 */
export const previewFactsFor = (unit: string) =>
  Effect.gen(function* () {
    const { previewAud, previewTeamDomain } = yield* Auth;
    return requirePreview(previewAud, previewTeamDomain, unit);
  });

export default Auth.make(
  {
    state: state(),
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);

    yield* AuthSchema;
    const database = yield* AuthDatabase;
    /**
     * BEFORE `Identity`, so the application exists as a declaration by the time
     * the Worker that sits behind it resolves. Both yields hit the same
     * memoised resource, so ordering is about legibility rather than
     * correctness — but reading it the other way round suggests a Worker can be
     * gated by an application declared afterwards, which is not a habit worth
     * teaching.
     */
    const preview = yield* PreviewAccessApp;
    yield* Identity;
    const { origin, cookieDomain } = ingress(stage, local);
    const features = yield* authFeatures;

    /**
     * Only under `alchemy dev`, and only when the CLI answered — a deployed
     * stage receives events from a registered endpoint. This is the one place
     * the activation half of a subscription can be exercised: a preview sits
     * behind Access, which answers Stripe with a login redirect.
     */
    if (stripeArmed) yield* StripeDev.forwarder(origin);

    return {
      origin,
      authBaseURL: `${origin}${features.basePath}`,
      cookieDomain,
      features,
      previewAud: Option.getOrElse(preview, () => UNGATED).aud,
      previewTeamDomain: Option.getOrElse(preview, () => UNGATED).teamDomain,
      // something is fucked if the below happens and we broke prod
      databaseId: Output.map(database.databaseId, (id) => {
        if (stage === PRODUCTION_STAGE && id !== PRODUCTION_DATABASE_ID) {
          throw new Error(
            `Refusing production: adopted database ${id}, expected ${PRODUCTION_DATABASE_ID}. ` +
              `"${PRODUCTION_DATABASE_NAME}" did not resolve to the live database — this deploy ` +
              `would point production at an empty one.`,
          );
        }
        return id;
      }),
    };
  }).pipe(Alchemy.AdoptPolicy.adopt()),
);
