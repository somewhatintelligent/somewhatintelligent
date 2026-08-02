/**
 * Does `bae.configure(…)` keep the plugin types Better Auth infers from?
 *
 * It has to, and the failure is silent, so this file measures it against the
 * shape that broke — which is a large part of why `configure` takes the options
 * rather than handing back an object to spread.
 *
 * `Bae` used to expose a `BetterAuthPlugin[]` you spread. That builds a
 * variadic tuple with a LEADING REST, `[...BetterAuthPlugin[], AdminPlugin]`,
 * and Better Auth walks it with
 *
 * ```ts
 * type InferPluginFieldFromTuple<T, Field, Acc = {}> =
 *   T extends readonly [infer Head, ...infer Tail]
 *     ? InferPluginFieldFromTuple<Tail, Field, Acc & ExtractPluginField<Head, Field>>
 *     : Acc
 * ```
 *
 * Against a leading rest, `Head` infers as the element type and `Tail` infers
 * as the SAME tuple. The walk makes no progress, never reaches the plugin at
 * the end, and every plugin added after the spread contributes nothing to
 * `$Infer` — `admin()` stops widening the user model with `role` and `banned`.
 *
 * Two things that looked like the cause and were not, both measured before this
 * was written: it is not tuple-versus-array, because `InferPluginTypes` has a
 * second branch that handles plain arrays; and it is not subtype reduction,
 * because the union TypeScript forms for the literal keeps the concrete plugin
 * type rather than collapsing it into `BetterAuthPlugin`.
 *
 * A fresh object literal in a call argument infers `plugins` from what is
 * written there, so no tuple is ever built by spread and the walk is over the
 * plugins the consumer actually wrote.
 *
 * The assertions are compile-time; `tsc --noEmit` is what runs them.
 */

import type { BetterAuthPlugin } from "better-auth";
import { admin } from "better-auth/plugins";
import { Effect } from "effect";
import { Bae } from "../src/Base.ts";
import type { UserOf } from "../src/Types.ts";

type Assert<T extends true> = T;
type Has<T, K extends string> = K extends keyof T ? true : false;

// ------------------------------------------------------------- what ships now

const wired = Effect.gen(function* () {
  const bae = yield* Bae;
  return yield* bae.configure({ appName: "probe", plugins: [admin()] });
});

/** Admin contributes four fields to the user model. All of them arrive. */
type KeepsRole = Assert<Has<UserOf<typeof wired>, "role">>;
type KeepsBanned = Assert<Has<UserOf<typeof wired>, "banned">>;
type KeepsBanReason = Assert<Has<UserOf<typeof wired>, "banReason">>;
type KeepsBanExpires = Assert<Has<UserOf<typeof wired>, "banExpires">>;

// --------------------------------------------- the control: the shape that broke

/** Stands in for the field `Bae` used to expose. Only its TYPE matters here. */
declare const arrayTyped: { readonly plugins: BetterAuthPlugin[] };

const spreadArray = Effect.gen(function* () {
  const bae = yield* Bae;
  return yield* bae.configure({
    appName: "probe",
    plugins: [...arrayTyped.plugins, admin()],
  });
});

/**
 * The regression this design prevents. Nothing about the configuration errors,
 * which is why it survived four capability backings, a live deployment, and a
 * clean typecheck.
 */
type SpreadLosesRole = Assert<Has<UserOf<typeof spreadArray>, "role"> extends false ? true : false>;
type SpreadLosesBanned = Assert<
  Has<UserOf<typeof spreadArray>, "banned"> extends false ? true : false
>;

// Referenced, not exported: exporting makes declaration emit name `typeof
// wired`, which reaches zod internals through the admin plugin and is TS2883.
declare const proof: [
  KeepsRole,
  KeepsBanned,
  KeepsBanReason,
  KeepsBanExpires,
  SpreadLosesRole,
  SpreadLosesBanned,
];
void proof;
