import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import { Astro } from "lib.astro-alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export class AuthRouting extends Context.Service<
  AuthRouting,
  { readonly origin: Output.Output<string> }
>()("platform.site/AuthRouting") {}

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
      },
    };
  }),
) {}

export type SiteEnv = Cloudflare.InferEnv<Site>;

export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
