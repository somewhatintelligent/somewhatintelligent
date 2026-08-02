/**
 * Can the options object itself be effectful — no `run.fn` at any callback?
 *
 *     BetterAuth({ sendResetPassword: (data) => Effect.gen(...) })
 *
 * Answer: YES, but `R` must be DECLARED, not inferred. The curried form at the
 * bottom of this file typechecks against the real `BetterAuthOptions`; the
 * inferred form above it does not, and the reason is a hard TypeScript limit.
 *
 * Four questions, asked separately because they have different answers:
 *
 *   Q1  Is `R` inferred as the UNION of every callback's requirement?   NO
 *   Q2  Is `data` still contextually typed with no annotation?          YES
 *   Q3  Does any of it survive the real `BetterAuthOptions`?            YES (Q2), NO (Q1)
 *   Q5  Does declaring `R` once, up front, work?                        YES
 *
 * Q1 is the interesting failure. TypeScript does not collect inference
 * candidates for `R` across the callback positions — it FIXES `R` from the
 * first site and then checks every later callback against that. So the second
 * callback in a literal is rejected for requiring the wrong service:
 *
 *     Type 'Effect<string, never, Sms>' is not assignable to
 *     type 'Effect<string, unknown, Mail>'.
 *
 * `Mail` there is not a mistake in the test — it is `R`, already pinned by
 * `sendResetPassword` earlier in the same object. In the two-argument variant
 * the same thing happens one step earlier: `R` is pinned by the base Effect,
 * and every callback is then measured against that. Both are recorded below,
 * commented out, with their real errors.
 *
 * Q5 is the salvage and it is a good one. Because Q2 holds — contextual typing
 * DOES reach through the mapped type into the callback argument — fixing `R`
 * with an explicit type argument in a first call gives you the shape you
 * actually wanted: no wrapper at any callsite, `R` written exactly once, and a
 * service you forgot to declare still rejected at the callback that reached for
 * it. The control at the end proves that last part.
 *
 * Type-level only; there is no runtime.
 */

import type { BetterAuthOptions } from "better-auth";
import { Effect } from "effect";
import { Mail, Sms } from "../src/Contract.ts";

/** Rewrite every function position in `T` to return an `Effect` requiring `R`. */
type Lift<T, R> = T extends (...args: infer A) => infer X
  ? (...args: A) => Effect.Effect<Awaited<X>, unknown, R>
  : T extends ReadonlyArray<infer E>
    ? ReadonlyArray<Lift<E, R>>
    : T extends object
      ? { [K in keyof T]: Lift<T[K], R> }
      : T;

/*
 * Q1/Q3 — RECORDED NEGATIVE. Uncomment to reproduce; it does not compile.
 *
 * declare function inferred<R>(options: Lift<BetterAuthOptions, R>): Effect.Effect<void, never, R>
 *
 * const real = inferred({
 *   emailAndPassword: {
 *     enabled: true,
 *     sendResetPassword: (data) =>            // pins R := Mail
 *       Effect.gen(function* () {
 *         const mail = yield* Mail
 *         yield* mail.send({ to: [data.user.email], subject: "Reset", text: data.url })
 *       }),
 *   },
 *   advanced: {
 *     database: {
 *       generateId: (options) =>              // TS2322: Sms is not Mail
 *         Effect.flatMap(Sms, (sms) => Effect.as(sms.send("+10000000000", options.model), "id")),
 *     },
 *   },
 * })
 */

/**
 * Q5 — the working shape. `R` declared once; the literal carries bare Effects.
 *
 * The `O extends Lift<...>` constraint is what supplies the contextual types:
 * `data` and `options` below have no annotations and are fully typed.
 */
declare function betterAuthEffect<R>(): <O extends Lift<BetterAuthOptions, R>>(
  options: O,
) => Effect.Effect<void, never, R>;

const viaCurry = betterAuthEffect<Mail | Sms>()({
  appName: "probe",
  emailAndPassword: {
    enabled: true,
    sendResetPassword: (data) =>
      Effect.gen(function* () {
        const mail = yield* Mail;
        yield* mail.send({ to: [data.user.email], subject: "Reset", text: data.url });
      }),
  },
  advanced: {
    database: {
      generateId: (options) =>
        Effect.flatMap(Sms, (sms) => Effect.as(sms.send("+10000000000", options.model), "id")),
    },
  },
});

/** Both callbacks accepted, and `R` is exactly what was declared. */
type CurriedR = Effect.Services<typeof viaCurry>;
const _curriedRIsExact: [
  CurriedR extends Mail | Sms ? true : false,
  Mail | Sms extends CurriedR ? true : false,
] = [true, true];
void _curriedRIsExact;

/*
 * Q5 CONTROL — RECORDED. Uncomment to confirm the guarantee still holds: a
 * callback reaching for a service that is not in the declared `R` is rejected,
 * which is the property the whole design exists to preserve.
 *
 * const q5Control = betterAuthEffect<Mail>()({
 *   emailVerification: {
 *     sendVerificationEmail: (data) =>
 *       Effect.flatMap(Sms, (sms) => sms.send("+1555", `verify ${data.url}`)),
 *   },
 * })
 *
 *   Type 'Effect<void, MailError, Sms>' is not assignable to
 *   type 'Effect<void, unknown, Mail>'.
 *     Type 'Sms' is not assignable to type 'Mail'.
 */
