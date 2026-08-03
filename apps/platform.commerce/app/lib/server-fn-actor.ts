/**
 * The server-function half of the call contract.
 *
 * `requireOperator` reads the actor `worker.ts` seeded into the request context
 * after verifying the Access assertion — it does NOT re-verify the JWT, because
 * that happened once at the boundary and a second verification per server
 * function is a second place for the check to differ. Its ABSENCE means the
 * boundary was bypassed, which is not a condition to recover from: a 500, never
 * a fallback actor.
 *
 * `operatorCall` builds the envelope Commerce takes. The browser supplies ONE
 * field toward it — an opaque `commandId` — and every other part is minted
 * here. A client that could choose its own `actor`, `requestId` or
 * `idempotencyKey` could assert an identity or collide with someone else's
 * writes by picking a key, which is exactly what namespacing prevents.
 */
import { createMiddleware, createServerOnlyFn, getGlobalStartContext } from "@tanstack/react-start";

import {
  deriveIdempotencyKey,
  type OperatorActor,
  type OperatorCall,
} from "../../domain/Contracts.ts";

const readActor = (): OperatorActor | undefined =>
  (getGlobalStartContext() as { actor?: OperatorActor } | undefined)?.actor;

/** Make the request's verified actor available to a handler as `context.actor`. */
export const requireOperator = createMiddleware({ type: "function" }).server(
  createServerOnlyFn(async ({ next }) => {
    const actor = readActor();
    if (!actor) throw new Response("operator actor unavailable", { status: 500 });
    return next({ context: { actor } });
  }),
);

/**
 * A browser-supplied retry key, as the client is required to spell it.
 *
 * Validated rather than trusted: it is namespaced into
 * `<actor.sub>:<action>:<commandId>` and becomes the domain's idempotency key,
 * so an empty or absurd one produces a key that collides with itself. A UUID is
 * what `crypto.randomUUID()` gives, which is what `commandId()` on the client
 * calls.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build the envelope for one mutation.
 *
 * `action` is chosen HERE, by the server function, and is never taken from the
 * request — it is half of the idempotency namespace, so a client that could
 * name it could make one command replay as another.
 *
 * `requestId` is fresh per attempt while `idempotencyKey` is stable across
 * them: that is the difference between "which HTTP call was this" and "which
 * user intent was this", and conflating them would make every retry a new
 * command.
 */
export const operatorCall = createServerOnlyFn(function operatorCall<T>(
  actor: OperatorActor,
  action: string,
  commandId: string,
  input: T,
): OperatorCall<T> {
  if (!UUID.test(commandId)) {
    throw new Response(`commandId must be a UUID, got ${JSON.stringify(commandId)}`, {
      status: 400,
    });
  }
  return {
    input,
    meta: {
      actor,
      requestId: crypto.randomUUID(),
      idempotencyKey: deriveIdempotencyKey(actor.sub, action, commandId),
    },
  };
});
