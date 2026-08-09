/**
 * WHAT THE AUTH STACK TELLS THE STACKS DEPLOYED AFTER IT, and how a commerce
 * Worker turns that into the two values its verifier needs.
 *
 * THIS FILE, rather than `module.ts`, because `module.ts` imports every Worker
 * in the package and `workers/Media.ts` needs these — importing back the other
 * way is a cycle. Nothing here imports a Worker, so both ends can read it.
 *
 * IT IMPORTS NO STACK EITHER, and that is a HARD constraint rather than tidiness.
 * `workers/Media.ts` is `main: import.meta.url` — the file IS the Worker entry,
 * so everything it can reach is bundled and evaluated in workerd at startup.
 * `@swi/infra/cloudflare.stack` declares resources and calls
 * `Cloudflare.providers()` at MODULE SCOPE, which no tree-shake can drop, and
 * that pulls the deploy-time bundler in behind it. Measured, on this branch: the
 * media Worker died at startup with `TypeError: t.resolve is not a function`
 * inside esbuild's `generateBinPath`, and the site went with it because it binds
 * media. `accessFacts` — the one export that needed a stack — lives in
 * `module.ts` now, which no Worker entry can reach.
 *
 * The tag itself moved out of `platform.site`, where it started, for the mirror
 * of the same reason: three of its four readers are commerce's, and
 * `platform.site` already imports commerce. `platform.site/module.ts`
 * re-exports it so its existing importers were unaffected.
 */
import type * as Output from "alchemy/Output";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { requirePreview, type PreviewAccess } from "@swi/infra/stage/preview";

export type { PreviewAccess };

/**
 * The shape is STRUCTURAL rather than imported from `platform.auth`: commerce
 * does not otherwise depend on the auth app, and this is three outputs. The
 * auth stack's own output type matches, so `Effect.provideService` type-checks
 * across the boundary without either side importing the other.
 */
export class AuthRouting extends Context.Service<
  AuthRouting,
  {
    readonly origin: Output.Output<string>;
    /**
     * The stage's shared Access application. BOTH EMPTY on production, where
     * every unit sits behind its own pinned, per-hostname application and reads
     * that application's `aud` directly. `infra/stage/preview.ts` says why the
     * emptiness is a value rather than a `null`.
     */
    readonly previewAud: Output.Output<string>;
    readonly previewTeamDomain: Output.Output<string>;
  }
>()(
  // The key is unchanged from when this lived in `platform.site`. It is an
  // identifier, not a location, and moving the file is not a reason to make an
  // already-deployed tag answer to a different name.
  "platform.site/AuthRouting",
) {}

/** The stage's shared application, refusing an ungated deploy. */
export const previewFacts: Effect.Effect<PreviewAccess, never, AuthRouting> = Effect.gen(
  function* () {
    const { previewAud, previewTeamDomain } = yield* AuthRouting;
    return requirePreview(previewAud, previewTeamDomain, "commerce");
  },
);
