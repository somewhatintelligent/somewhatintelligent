/**
 * The live suite's own stack: the real Worker from `src/server/entry.ts`, with
 * the real bindings, and nothing that only a deploy to the internet needs.
 *
 * It is deliberately NOT `alchemy.run.ts`. That stack carries the Access
 * application, the apex custom domain and the wildcard artifact domain — three
 * account-level objects a test must not contend for, and none of which the
 * behaviour under test depends on: `entry.ts` matches artifact hosts before the
 * gate, and `AUTH: "none"` composes the gate out entirely. What is left is
 * exactly the surface section 14 asks the live suite to exercise.
 *
 * Run under `dev: true` the Worker runs locally in workerd. R2 has no local
 * emulation in alchemy 2.0.0-beta.65 (`toRuntimeBinding` maps `r2_bucket` to
 * `R2Bucket.remote`), so the bucket below is a REAL bucket on the profile's
 * account, remote-bound into the local runtime, and `destroy` empties and
 * removes it.
 */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { Owner as OwnerClass } from "../src/server/entry.ts";
import Vantage from "./Vantage.ts";

export const STAGE = "integ";

/**
 * The artifact origin's suffix. A reserved TLD (RFC 2606) on purpose: nothing
 * resolves it in DNS, and nothing needs to — the suite reaches the origin
 * through the `Vantage.ts` service binding, and `parseArtifactHost` keys off
 * the URL's hostname and nothing else.
 *
 * It must not be a suffix of the hostname the Worker is actually served on, or
 * `serveArtifact` would swallow every request and `/mcp` would never be
 * reached. In dev that hostname is `127.0.0.1` — which, with a suffix of
 * `0.0.1`, parses as the perfectly valid slug `127`.
 */
export const ARTIFACT_SUFFIX = "a-integ.mezedes.test";
/** The one origin an artifact permits as a framer. See `harden` in `serve.ts`. */
export const SHELL_ORIGIN = "https://shell-integ.mezedes.test";

const COMPATIBILITY_DATE = "2026-07-01";

/** Bytes. Blobs, assets and published manifests. */
const Blobs = Cloudflare.R2.Bucket("Blobs");

/** The index. Alchemy creates every new DO class under `new_sqlite_classes`. */
const OwnerObject = Cloudflare.DurableObject<OwnerClass>("Owner", { className: "Owner" });

/**
 * `main` and the shell directory are resolved from this module rather than the
 * process, so the suite does not depend on where it was invoked from. The shell
 * is a vite build output: run `bun run build` before the suite, or the ASSETS
 * binding has nothing to serve.
 */
const ENTRY = new URL("../src/server/entry.ts", import.meta.url).href;
const SHELL = new URL("../dist/shell", import.meta.url).pathname;
/**
 * Resolved here rather than in `Vantage.ts`: see the note in `Origin.ts`.
 *
 * alchemy takes a PATH, so the import above is what keeps the fixture in the
 * import graph — and it pays for itself: a `Vantage.ts` that has stopped
 * default-exporting a handler fails here, at plan time, instead of as a dev
 * server that accepts connections and never answers.
 */
const VANTAGE_ENTRY = new URL("./Vantage.ts", import.meta.url).href;

if (typeof Vantage.fetch !== "function") {
  throw new TypeError(`${VANTAGE_ENTRY} must default-export a fetch handler`);
}

export default Alchemy.Stack(
  "MezedesInteg",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker("Mezedes", {
      main: ENTRY,
      url: true,
      /**
       * Two Workers in one stack both default to 1337 and race for the next
       * free port; pinning them apart is what keeps the reported URL and the
       * bound port the same thing. Not `strictPort`: a busy port must move on
       * rather than fail the run.
       */
      dev: { port: 14337 },
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      /**
       * `runWorkerFirst` is the one line here that `alchemy.run.ts` does not
       * have, and its absence there is a defect this suite found rather than a
       * difference it invented. Cloudflare's asset router runs BEFORE the
       * Worker script, on every hostname the Worker answers, for every path
       * that matches an asset — and `/` matches `dist/shell/index.html`. So on
       * a real deploy `https://<slug>.a.<zone>/` returns the SHELL's HTML and
       * `entry.ts` never runs: no mezes can serve its own root page. Verified
       * against a deploy: `/` on an artifact host came back as the shell while
       * `/mcp` and `/api/mezedes` on the same host correctly returned the
       * artifact origin's `not found`.
       *
       * The suite puts the Worker in front so its assertions are about
       * `entry.ts`'s ordering rather than about the router in front of it. The
       * shell still serves: `entry.ts` falls through to `env.ASSETS.fetch`.
       */
      assets: {
        directory: SHELL,
        notFoundHandling: "single-page-application",
        runWorkerFirst: true,
      },
      env: {
        BLOBS: Blobs,
        OWNER: OwnerObject,
        LOADER: Cloudflare.WorkerLoader("LOADER"),
        /**
         * The dev value, and the reason this suite needs no token. Section 14
         * asserts the gate is composed out at `AUTH=none`; `entry.ts` only
         * consults `authorize` when this reads "access". Running the suite
         * against the cloud (`ALCHEMY_DEV=0`) therefore publishes an
         * unauthenticated workers.dev URL for as long as the run takes — which
         * is why `dev: true` is the default and the remote path is opt-in.
         */
        AUTH: "none",
        /** Unused while AUTH is "none"; the binding contract still wants them. */
        POLICY_AUD: "",
        TEAM_DOMAIN: "",
        ARTIFACT_SUFFIX,
        SHELL_ORIGIN,
      },
    });

    /**
     * The suite's way in to the artifact origin. See `Vantage.ts`: under
     * `alchemy dev` the client's hostname never survives the dev proxy, and a
     * service binding is the one hop that carries a URL the Worker will read.
     */
    const vantage = yield* Cloudflare.Worker("Vantage", {
      main: VANTAGE_ENTRY,
      url: true,
      dev: { port: 14338 },
      compatibility: { date: COMPATIBILITY_DATE },
      env: { MEZEDES: worker },
    });

    return {
      /** Where alchemy actually bound — in dev, a port it chose. */
      url: worker.url.as<string>(),
      vantage: vantage.url.as<string>(),
      artifactSuffix: ARTIFACT_SUFFIX,
    };
  }),
);
