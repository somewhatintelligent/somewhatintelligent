import { createStart } from "@tanstack/react-start";

/**
 * The Start instance. It carries no request middleware that touches identity:
 * the session is resolved once at the Worker boundary and read back through
 * `requireUser` / `requireAdmin`, so a middleware here that re-resolved it would
 * be a second, divergent copy of the only authentication this app has.
 */
export const startInstance = createStart(() => ({}));
