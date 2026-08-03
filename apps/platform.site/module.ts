import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import { Astro } from "lib.astro-alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import * as Bindings from "./binding.ts";

export class AuthRouting extends Context.Service<
  AuthRouting,
  { readonly origin: Output.Output<string> }
>()("platform.site/AuthRouting") {}

export class Site extends Astro<Site>()(
  "Site",
  Effect.gen(function* () {
    const auth = yield* AuthRouting;
    /**
     * REFS, not local declarations — these two workers belong to the commerce
     * stack and are deployed by it. See `./binding.ts` for what a ref costs and
     * why both are penned there.
     */
    const commerce = yield* Bindings.commerce;
    const media = yield* Bindings.media;

    return {
      cwd: import.meta.dirname,
      workersDev: true,
      adapter: { imageService: "passthrough" },
      env: {
        AUTH_ORIGIN: auth.origin.as<string>(),
        /**
         * The catalogue, over a binding rather than over HTTP — and the choice
         * is not stylistic. Commerce mounts NO HTTP SURFACE AT ALL, which is
         * the property that keeps thirty-three methods off the public
         * internet; the reads this site needs were put on the bound surface
         * for exactly this caller. The storefront HTTP API that does exist
         * lives in `tests/workers/`, and it is unshipped because it also
         * serves the anonymous `placeOrder`.
         */
        COMMERCE: commerce,
        /** Serves the `/media/<id>` hrefs product rows carry. */
        MEDIA: media,
      },
    };
  }),
) {}

export type SiteEnv = Cloudflare.InferEnv<Site>;

export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
