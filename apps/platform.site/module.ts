import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import { Astro } from "lib.astro-alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import CommerceWorker from "platform.commerce/workers/Commerce";
import MediaWorker from "platform.commerce/workers/Media";

export class AuthRouting extends Context.Service<
  AuthRouting,
  { readonly origin: Output.Output<string> }
>()("platform.site/AuthRouting") {}

/**
 * THE PUBLIC SITE, deployed in the SAME STACK as the commerce substrate it
 * binds — which is why this names those Workers directly instead of resolving
 * them out of another stack.
 *
 * IT USED TO REF THEM ACROSS A STACK BOUNDARY, and that worked in a deploy and
 * only in a deploy. `Worker.ref` reads its target from another stack's
 * persisted state, which a real deployment has; two `alchemy dev` sessions have
 * two dev registries and no way to see into each other, so the site's local
 * miniflare received something that was not a stub and every local request
 * rendered the shop's "catalogue unavailable" plate.
 *
 * Declaring both here puts them in one dev session and one registry — the same
 * reason the operator console could always reach Commerce locally and this
 * could not. It also deletes `binding.ts` entirely: no cast around
 * `Cloudflare.Worker`'s missing `ref` declaration, no `Deployed<W>` helper to
 * recover the shape `InferEnv` needs, and no stack-name string that no import
 * graph can check.
 *
 * THE BARE CLASS, NOT A YIELDED VALUE. `lib.astro-alchemy`'s own fixture binds
 * `API: ApiWorker` this way and is the shape its tests prove; the deploy path
 * resolves a class-form declaration itself.
 */
export class Site extends Astro<Site>()(
  "Site",
  Effect.gen(function* () {
    const auth = yield* AuthRouting;

    return {
      cwd: import.meta.dirname,
      workersDev: true,
      adapter: { imageService: "passthrough" },
      env: {
        AUTH_ORIGIN: auth.origin.as<string>(),
        /**
         * The catalogue, over a binding rather than over HTTP — and the choice
         * is not stylistic. Commerce mounts NO HTTP SURFACE AT ALL, which is
         * what keeps thirty-three methods off the public internet; the reads
         * this site needs were put on the bound surface for exactly this
         * caller.
         *
         * THE BINDING GRANTS ALL THIRTY-THREE. What bounds it is that
         * `src/lib/commerce.ts` is the only module holding the stub and it
         * exposes no passthrough.
         */
        COMMERCE: CommerceWorker,
        /** Serves the `/media/<id>` hrefs product rows carry. */
        MEDIA: MediaWorker,
      },
    };
  }),
) {}

export type SiteEnv = Cloudflare.InferEnv<Site>;

export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
