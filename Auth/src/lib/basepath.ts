/**
 * The mount-prefix resolver — the ONE place the `/account` mount enters app code.
 *
 * Identity is vmf-mounted at `/account` behind bouncer: bouncer STRIPS the mount
 * before the request reaches the worker, so the SERVER always serves at root
 * (`/sign-in`, `/account`, …) and every route definition / `<Link>` / redirect
 * in the app stays prefix-free. The one thing bouncer's HTTP-layer rewrite
 * cannot reach is the hydrated client router's history/link state — so the
 * CLIENT router adopts the mount as a TanStack Router `rewrite` pair
 * (`mountRewrite` below): strip the mount when parsing the browser URL,
 * prepend it when writing to history. Result: the URL bar keeps `/account`
 * across client-side navigation and hard refreshes, with zero prefixes in
 * app code.
 *
 * The mount is announced at RUNTIME by bouncer's vmf HTML transform
 * (`<meta name="si-mount">`), with no build-time fallback for
 * identity (the runtime si-mount meta is the only source); `/` in local
 * dev-direct (no bouncer, no mount).
 */

/** Normalize a raw base to a leading-slash, no-trailing-slash form ("/" stays "/"). */
export function normalizeBasepath(raw: string | undefined | null): string {
  if (raw == null) return "/";
  let b = raw.trim();
  if (b === "" || b === "/") return "/";
  if (!b.startsWith("/")) b = `/${b}`;
  while (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b;
}

/**
 * The mount for the current execution side.
 *
 * - Server: always "/" — bouncer already stripped the mount, so the server
 *   router matches the stripped (root) path. A non-root mount here would
 *   fail to match the stripped path.
 * - Client: the mount announced at RUNTIME by bouncer's vmf HTML transform
 *   (`<meta name="si-mount">` — see bouncer's MountMetaInjector) wins, then
 *   the build-time PUBLIC_BASE fallback, then "/". The runtime meta is the
 *   authoritative source: it needs no build-time config and is correct for
 *   whatever mount bouncer actually served this document under.
 */
export function resolveBasepath(opts: {
  isServer: boolean;
  publicBase: string | undefined | null;
  mountMeta?: string | undefined | null;
}): string {
  if (opts.isServer) return "/";
  const meta = opts.mountMeta?.trim();
  if (meta) return normalizeBasepath(meta);
  return normalizeBasepath(opts.publicBase);
}

/** Reads bouncer's vmf mount announcement from the served document (client only). */
export function readMountMeta(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="si-mount"]')?.getAttribute("content") ?? null;
}

/**
 * The browser-frame (public) form of a root-relative app path: the vmf mount
 * prepended when the client is running under one, the path unchanged
 * otherwise (the server never sees the mount; dev-direct has none). Absolute
 * URLs pass through untouched.
 *
 * Why this exists: `redirect({ href })` / `navigate({ href })` read `href`
 * as a BROWSER URL — the router runs it through the mount rewrite's `input`
 * (strip) before matching. A router-INTERNAL path handed to them raw
 * therefore shifts meaning under the mount, and the post-auth default
 * target `/account` is byte-identical to the mount itself, so it collapses
 * to `/` and ping-pongs against the index route's own redirect forever (the
 * "sign-in hangs calling loadSession" loop). Prefer `to`-based navigation
 * for literal internal routes; use this for dynamic string targets
 * (returnTo, the OAuth authorize URL) that must survive both frames.
 */
export function toBrowserHref(path: string): string {
  if (!path.startsWith("/")) return path;
  const mount = resolveBasepath({
    isServer: typeof document === "undefined",
    publicBase: null,
    mountMeta: readMountMeta(),
  });
  return mount === "/" ? path : mount + path;
}

/**
 * The mount expressed as a TanStack Router `rewrite` pair (browser URL ↔
 * router-internal URL): strip the mount on input, prepend it on output.
 *
 * Uses `rewrite`, not the `basepath` router option: TanStack Start's server
 * handler (start-server-core createStartHandler) and client bootstrap
 * (start-client-core hydrateStart) both call
 * `router.update({ basepath: process.env.TSS_ROUTER_BASEPATH })`, overriding
 * any basepath set in createRouter with that build-time define. `rewrite` is
 * the documented channel for an asymmetric mount: router.update()
 * re-composes `options.rewrite` after the basepath rewrite on every update,
 * and Start never touches it.
 * https://tanstack.com/router/latest/docs/guide/url-rewrites#interaction-with-basepath
 */
export function mountRewrite(mount: string):
  | {
      input: (opts: { url: URL }) => URL;
      output: (opts: { url: URL }) => URL;
    }
  | undefined {
  const m = normalizeBasepath(mount);
  if (m === "/") return undefined;
  return {
    input: ({ url }) => {
      if (url.pathname === m) url.pathname = "/";
      else if (url.pathname.startsWith(`${m}/`)) url.pathname = url.pathname.slice(m.length);
      return url;
    },
    output: ({ url }) => {
      url.pathname = url.pathname === "/" ? m : m + url.pathname;
      return url;
    },
  };
}
