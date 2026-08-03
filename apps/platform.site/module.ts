import { Astro } from "lib.astro-alchemy";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

/**
 * The Astro project root, derived from this module rather than from
 * `process.cwd()`. This is the point of the `cwd` prop: the stack that yields
 * the site lives in `stacks/platform.site/`, the app lives here, and neither
 * knows where the other is — nor where `alchemy deploy` was invoked from.
 */
const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * The public site, deployed as an Astro SSR Worker.
 *
 * NO `env`. Not an omission to fill in later — the scaffold deliberately binds
 * nothing, so the only thing a deploy can prove is that the build, the upload
 * and the SSR path work. The home page renders a committed document (see
 * `src/lib/home-document.ts`), which is what makes that provable without a
 * single resource behind it.
 *
 * `imageService: "passthrough"` for the same reason. The adapter's default
 * (`"compile"`) and its Cloudflare Images service both want more than nothing;
 * passthrough emits `src/assets/` through the client build untouched, so the
 * hero image ships as a plain hashed asset off the ASSETS layer. Carried over
 * verbatim from the site this replaces.
 *
 * A missing `SESSION` KV is likewise deliberate: the adapter installs its KV
 * session driver regardless and only throws when `Astro.session` is actually
 * read — which nothing here does.
 *
 * Class form so the resource can be referenced as a type, matching every other
 * app in the repo.
 */
export class Site extends Astro<Site>()("Site", {
  cwd: APP_ROOT,
  /** The scaffold's only public address. No zone, no custom domain, no DNS. */
  workersDev: true,
  adapter: { imageService: "passthrough" },
}) {}

/**
 * THE DEPLOYABLE UNIT.
 *
 * Parameterless: this app has no peers and no upstreams. The stack name, the
 * state layer and the adopt policy live in `stacks/platform.site/` — they are
 * composition, not this app's business.
 */
export const SiteModule = Effect.gen(function* () {
  const site = yield* Site;

  return { url: site.url.as<string>(), workerName: site.workerName };
});
