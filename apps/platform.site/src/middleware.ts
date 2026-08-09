/**
 * THE PREVIEW GATE, inside the site's Worker.
 *
 * Every HTML route here is server-rendered — the stack forces Astro's
 * `output: "server"` and no page opts back out with `prerender = true` — so
 * this runs in front of all of them. Client assets (the CSS and JS bundles)
 * are served straight from the assets binding without entering the Worker, and
 * are covered by the Access edge alone; that is the deliberate boundary of what
 * in-band verification can reach here, and a stylesheet is not the thing a
 * preview is hiding.
 *
 * `GATE` is `"none"` on production — this is a public storefront — and under
 * `alchemy dev`. On every preview it is `"access"`.
 *
 * `cloudflare:workers` RATHER THAN `context.locals.runtime.env`, which is the
 * convention everywhere else and is wrong here: that getter was removed in
 * Astro v6+ and throws. `src/lib/commerce.ts` reads the env the same way and
 * says so at greater length. It is read inside the handler rather than at
 * module scope so importing this at build time, when no binding exists, is
 * harmless.
 */
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { refusal, verifyAccess } from "lib.access-jwt";

export const onRequest = defineMiddleware(async (context, next) => {
  if (env.GATE !== "access") return next();

  const verdict = await verifyAccess(context.request, env);
  if (!verdict.ok) return refusal(verdict);

  return next();
});
