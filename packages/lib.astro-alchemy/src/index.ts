/**
 * An Alchemy resource for Astro SSR sites on Cloudflare Workers.
 *
 * `Cloudflare.Website.Vite` cannot build Astro — Astro's build is driven by
 * the `astro` CLI, not a plain `vite build`. But Astro exposes a Node API
 * (`build` / `dev`, taking an `AstroInlineConfig extends AstroUserConfig`), so
 * this resource drives it directly and injects the Cloudflare adapter with
 * options derived from the stack — exactly as `Website.Vite` injects the
 * Cloudflare vite plugin rather than asking you to add it yourself.
 *
 * @example
 * ```ts
 * export class Site extends Astro<Site>()("Site", {
 *   cwd: fileURLToPath(new URL(".", import.meta.url)),
 *   env: { SESSION: SessionKv, API: ApiWorker },
 * }) {}
 *
 * export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
 * ```
 */
export { Astro, type AstroProps } from "./Astro.ts";
