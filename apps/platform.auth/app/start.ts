import { createStart } from "@tanstack/react-start";
import { csrfMiddleware, tracingMiddleware } from "lib.observability/tanstack-start";

/**
 * The Start instance. It carries no request middleware that touches identity:
 * the session is resolved once at the Worker boundary and read back through
 * `requireUser` / `requireAdmin`, so a middleware here that re-resolved it would
 * be a second, divergent copy of the only authentication this app has.
 *
 * The tracing middleware holds to that. It reads only what Start already knows
 * about the request — method, route, which server function — and never touches
 * the session or the data a server function was called with.
 */
/**
 * Tracing wraps CSRF, not the other way round: a refused request is exactly the
 * one worth seeing, and this order is what puts the rejected server function's
 * name on a span instead of leaving a bare 403 with nothing attached to it.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware, csrfMiddleware],
}));
