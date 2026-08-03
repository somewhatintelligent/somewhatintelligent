import { createStart } from "@tanstack/react-start";

/**
 * The console resolves its actor ONCE, at the Worker boundary (`worker.ts`,
 * via the Access gate) and seeds it into the request context. Server functions
 * read it back through `requireOperator` rather than re-verifying the
 * assertion, which is why there is no request middleware here doing it again.
 */
export const startInstance = createStart(() => ({}));
