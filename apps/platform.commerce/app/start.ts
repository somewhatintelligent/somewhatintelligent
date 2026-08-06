import { createStart } from "@tanstack/react-start";
import { tracingMiddleware } from "@swi/infra/tss";

/**
 * The console resolves its actor ONCE, at the Worker boundary (`worker.ts`,
 * via the Access gate) and seeds it into the request context. Server functions
 * read it back through `requireOperator` rather than re-verifying the
 * assertion, which is why there is no request middleware here doing it again.
 *
 * The tracing middleware is not an exception to that: it reads what Start
 * already knows about the request and never resolves identity.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware],
}));
