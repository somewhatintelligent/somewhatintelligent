/**
 * The result envelope and the idempotency key derivation.
 *
 * Extracted from `Domain/Contracts.ts` unchanged. Both are pure and both are
 * load-bearing for correctness rather than convenience, which is exactly the
 * kind of thing that should be provable without a deployment.
 *
 * No method ever throws for a domain condition. Success and typed domain errors
 * are both {@link DomainResult} values — that is what lets a failure skip the
 * audit write without unwinding a batch.
 */

export type DomainResult<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message?: string };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/**
 * `err(code)` with no message OMITS the `message` key rather than setting it to
 * `undefined`. The whole result is JSON-serialised into the audit row and
 * replayed verbatim, so key presence has to be byte-stable across a replay.
 */
export const err = <E extends string>(
  error: E,
  message?: string,
): { ok: false; error: E; message?: string } =>
  message === undefined ? { ok: false, error } : { ok: false, error, message };

/**
 * Namespace a browser command into a domain idempotency key. Retrying the same
 * UI command is stable without letting the browser choose the namespace — a
 * client that picked its own could suppress another actor's writes by colliding.
 */
export const deriveIdempotencyKey = (actorSub: string, action: string, commandId: string): string =>
  `${actorSub}:${action}:${commandId}`;
