import { defineMiddleware } from "astro:middleware";

// Runs in the Worker on every SSR request. Prerendered routes bypass it.
export const onRequest = defineMiddleware(async (ctx, next) => {
  const res = await next();
  res.headers.set("x-astro-middleware", "ran");
  res.headers.set("x-astro-path", ctx.url.pathname);
  return res;
});
