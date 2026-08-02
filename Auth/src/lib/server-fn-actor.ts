/**
 * The server-function half of the session boundary.
 *
 * `requireUser` reads the session the Worker boundary seeded. It does NOT
 * re-resolve it — that happened once, at the boundary — so its absence means the
 * boundary was bypassed, which is not a condition to recover from: it fails
 * closed with a 500 rather than treating the caller as anonymous.
 *
 * `requireAdmin` is the same read plus a role check. Note what it is NOT: the
 * authorization that matters happens inside Better Auth, on the auth server,
 * against the forwarded cookie. This gate exists so an admin server function
 * refuses early and legibly instead of making a call that will 403 — and so a
 * route added to the admin tree cannot forget to.
 *
 * Ported in shape from si's `lib/middleware/auth.ts`, which built the same two
 * gates over a bouncer attestation envelope. There is no envelope here: the
 * session came from the auth server directly, over the service binding.
 */
import { createMiddleware, createServerOnlyFn, getGlobalStartContext } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { isAdmin, type IdentitySession } from "./session.ts";

const readSession = (): IdentitySession | null | undefined =>
  (getGlobalStartContext() as { session?: IdentitySession | null } | undefined)?.session;

/**
 * The caller's raw `Cookie` header, which is what every Bae RPC method takes as
 * its credential.
 *
 * Read from the LIVE REQUEST, deliberately, and not carried in the request
 * context alongside the session. The session is a description of a person and is
 * safe to hold; the cookie IS the credential, and a context that ever gets
 * serialised toward the client would put a live session token in the HTML. There
 * is no reason to take that risk when the header is one call away.
 */
const cookieHeader = (): string => getRequestHeader("cookie") ?? "";

export const requireUser = createMiddleware({ type: "function" }).server(
  createServerOnlyFn(async ({ next }) => {
    const session = readSession();
    if (session === undefined) {
      throw new Response("session unavailable", { status: 500 });
    }
    if (session === null) {
      throw new Response("unauthorized", { status: 401 });
    }
    return next({ context: { session, cookie: cookieHeader() } });
  }),
);

export const requireAdmin = createMiddleware({ type: "function" }).server(
  createServerOnlyFn(async ({ next }) => {
    const session = readSession();
    if (session === undefined) {
      throw new Response("session unavailable", { status: 500 });
    }
    if (session === null || !isAdmin(session)) {
      throw new Response("forbidden", { status: 403 });
    }
    return next({ context: { session, cookie: cookieHeader() } });
  }),
);
