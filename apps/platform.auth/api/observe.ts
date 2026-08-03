import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

/**
 * IT MUST BE IMPOSSIBLE FOR THIS WORKER TO FAIL WITHOUT SAYING WHY.
 *
 * `Effect.orDie` turns a typed failure into a defect, and a defect in a Worker
 * is a dead isolate printing whatever the runtime chooses — which, for a hang,
 * is `undefined`. Every bare `orDie` was a place an error could vanish. These
 * are the replacements; prefer them anywhere a cause can be produced.
 *
 * `tapCause` rather than `tapError`: a defect and an interruption are exactly
 * the cases that were disappearing, and only the cause channel carries them.
 */

const record = (label: string) => (cause: Cause.Cause<unknown>) =>
  Effect.logError(`auth: ${label} failed\n${Cause.pretty(cause)}`);

/** `orDie`, with the full cause on the record first. */
export const orDieLogged = <A, E, R>(
  label: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, never, R> => Effect.orDie(Effect.tapCause(effect, record(label)));

/** Log the cause and re-raise it unchanged, for paths that keep their error type. */
export const traced = <A, E, R>(
  label: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.tapCause(effect, record(label));

/**
 * A HANG HAS NO CAUSE TO LOG — the one failure mode the helpers above cannot
 * cover, because the runtime kills the isolate and prints nothing useful. A
 * deadline turns "never answers" into a failure that does.
 *
 * A tripwire, not a latency budget: any step here that takes seconds is already
 * broken, and the point is to learn WHICH step.
 */
export const deadline = <A, E, R>(
  label: string,
  seconds: number,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  traced(
    label,
    Effect.timeoutOrElse(effect, {
      duration: Duration.seconds(seconds),
      /**
       * Logs, THEN dies. It cannot fail: the Worker body's error channel is
       * `never`, so a timeout has to leave as a defect — but never before the
       * reason is on the record, which is the whole point of this module.
       */
      orElse: () => {
        const message =
          `auth: ${label} did not settle within ${seconds}s. The Workers runtime ` +
          `reports this as a hung Worker with no cause, so this deadline exists ` +
          `to name the step instead.`;
        return Effect.flatMap(Effect.logError(message), () => Effect.die(new Error(message)));
      },
    }),
  );

/** Announce a step, so the tail shows how far startup got before it stopped. */
export const step = <A, E, R>(
  label: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.logInfo(`auth: ${label} …`), () =>
    Effect.tap(effect, () => Effect.logInfo(`auth: ${label} ok`)),
  );
