import * as Alchemy from "alchemy";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Effect } from "effect";

import { AvatarBucket } from "./api/avatars.ts";
import { AuthDatabase, PRODUCTION_DATABASE_ID, PRODUCTION_DATABASE_NAME } from "./api/database.ts";
import { authFeatures } from "./api/options.ts";
import { PACKAGE_DIR } from "./paths.ts";
import AuthWorker from "./api/worker.ts";
import { PRODUCTION_STAGE } from "platform.names";
import { DEV_PORT, ingress } from "./shared/ingress.ts";
import { authDefines } from "./shared/surfaces.ts";

import { AuthSchema } from "./api/schema.ts";

export class Identity extends Cloudflare.Website.Vite<Identity>()(
  "SomewhatIntelligentAuthApp",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);
    const { name, hostname } = ingress(stage, local);

    return {
      name,
      /**
       * `rootDir` is Vite's root and defaults to `process.cwd()`; `main` is the
       * ONE path here that resolves from `rootDir` rather than from cwd. Both
       * were left implicit while this package was also the directory alchemy
       * ran in — and stopped being true the moment the deploy scripts moved to
       * the repo root. Stated now, and repo-root-relative because it is a
       * persisted prop like the others (see `./paths.ts`).
       *
       * A wrong root fails at BUILD, not at plan, so no `alchemy plan` will
       * ever tell you this is broken. `alchemy dev` will.
       */
      rootDir: PACKAGE_DIR,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        AUTH: AuthWorker,
        AVATARS: yield* AvatarBucket,
        // `VITE_` entries are inlined as `import.meta.env.*` literals before
        // rolldown runs. Derived from the options the worker actually runs, so
        // the app cannot advertise a flow the server would answer 404 for.
        ...authDefines(yield* authFeatures),
      },
      dev: { port: DEV_PORT, strictPort: true },
      /**
       * The claimed hostname, and its inverse: a stage that claims a domain
       * does not also answer on workers.dev, because a second public address
       * for the login is a second origin the cookie is not scoped to.
       */
      ...(hostname === null ? {} : { domain: [hostname] }),
      url: hostname === null,
    };
  }),
) {}

export type IdentityEnv = Cloudflare.Workers.InferEnv<Identity>;

/**
 * THE DEPLOYABLE UNIT, and everything it owns.
 *
 * Parameterless: every resource below reads the stage it needs from
 * `Alchemy.Stack` itself, so a composer never passes one down. The state layer,
 * the providers and the adopt policy live in `stacks/platform.auth/` — they are
 * composition, not this app's business.
 *
 * The returned shape is checked against `AuthRouting` by `Auth.make` at the
 * composition site rather than by a `satisfies` here. The contract belongs to
 * the stack that publishes it, and the app importing it back would point an app
 * at a stack.
 */
export const AuthModule = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);

  yield* AuthSchema;
  const database = yield* AuthDatabase;
  yield* Identity;

  // The same pure function the auth worker's own bindings come from, never
  // `identity.url`: in production the app claims a hostname and has no
  // workers.dev URL to report.
  const { origin, cookieDomain } = ingress(stage, local);

  // The same resolved options the worker runs and the schema is generated
  // from, so `authBaseURL` is composed from the real mount path rather than
  // restated beside it.
  const features = yield* authFeatures;

  return {
    origin,
    authBaseURL: `${origin}${features.basePath}`,
    cookieDomain,
    features,
    /**
     * Adoption matches by NAME and CREATES on a miss, so a wrong name is a
     * green deploy onto an empty database. This turns that into a failed one.
     */
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
});
