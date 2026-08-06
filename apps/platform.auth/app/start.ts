import { createStart } from "@tanstack/react-start";
import { tracingMiddleware } from "@swi/infra/tss";

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
export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware],
}));
