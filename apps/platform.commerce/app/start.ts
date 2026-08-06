import { createStart } from "@tanstack/react-start";
import { csrfMiddleware, tracingMiddleware } from "@swi/infra/tss";

/**
 * The console resolves its actor ONCE, at the Worker boundary (`worker.ts`,
 * via the Access gate) and seeds it into the request context. Server functions
 * read it back through `requireOperator` rather than re-verifying the
 * assertion, which is why there is no request middleware here doing it again.
 *
 * The tracing middleware is not an exception to that: it reads what Start
 * already knows about the request and never resolves identity.
 */
/**
 * Tracing wraps CSRF, not the other way round: a refused request is exactly the
 * one worth seeing, and this order is what puts the rejected server function's
 * name on a span instead of leaving a bare 403 with nothing attached to it.
 *
 * Access already fronts this console, so CSRF is the second gate rather than
 * the only one — but the binding it holds writes to the catalogue and the order
 * book, and a staff browser is exactly what a cross-site POST would be riding.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware, csrfMiddleware],
}));
