/**
 * WHAT THE AUTH STACK TELLS THE STACKS DEPLOYED AFTER IT, and how a commerce
 * Worker turns that into the two values its verifier needs.
 *
 * THIS FILE, rather than `module.ts`, because `module.ts` imports every Worker
 * in the package and `workers/Media.ts` needs these — importing back the other
 * way is a cycle. Nothing here imports a Worker, so both ends can read it.
 *
 * The tag itself moved out of `platform.site`, where it started, for the mirror
 * of the same reason: three of its four readers are commerce's, and
 * `platform.site` already imports commerce. `platform.site/module.ts`
 * re-exports it so its existing importers were unaffected.
 */
import * as Output from "alchemy/Output";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { CloudflareStack, InternalAccessApplication } from "@swi/infra/cloudflare.stack";
import { requirePreview, type PreviewAccess } from "@swi/infra/stage/preview";
import { TieredEffect } from "@swi/infra/stage/StandardizedStage";

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
 */
export const accessFacts = (id: string, domain: string) =>
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
