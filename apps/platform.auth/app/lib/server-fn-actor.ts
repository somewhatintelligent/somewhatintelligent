/**
 * The server-function half of the session boundary.
 *
 * `requireUser` reads the session the Worker boundary seeded rather than
 * re-resolving it, so its absence means the boundary was bypassed — not a
 * condition to recover from, hence a 500 rather than treating the caller as
 * anonymous.
 *
 * `requireAdmin` adds a role check, but the authorization that matters happens
 * inside Better Auth against the forwarded cookie. This gate only makes an
 * admin server function refuse early and legibly instead of making a call that
 * will 403 — and stops a route added to the admin tree from forgetting to.
 */
import { createMiddleware, createServerOnlyFn, getGlobalStartContext } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { isAdmin, type IdentitySession } from "./session.ts";

const readSession = (): IdentitySession | null | undefined =>
  (getGlobalStartContext() as { session?: IdentitySession | null } | undefined)?.session;

/**
 * The caller's raw `Cookie` header, the credential every Bae RPC method takes.
 *
 * Read from the LIVE REQUEST rather than carried in the request context: the
 * session is a description of a person and is safe to hold, but the cookie IS
 * the credential, and a context that ever serialises toward the client would
 * put a live session token in the HTML.
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
