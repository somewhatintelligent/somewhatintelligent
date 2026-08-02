/**
 * Two open questions about the `Bae` design, answered at compile time.
 *
 * 1. Can a capability be wired in OPTIONALLY — present when its Layer is
 *    provided, absent when it is not — without the tag entering `R` and
 *    forcing every deployment to provide it? `Effect.serviceOption` says yes.
 * 2. Does SPREADING a base fragment into the options literal preserve Better
 *    Auth's plugin inference? Both prior regressions in this area (`:` vs
 *    `satisfies`, and a non-generic handler parameter) were SILENT: `auth.api`
 *    quietly loses every plugin endpoint and nothing errors. So this is
 *    asserted with controls rather than assumed.
 *
 * Run: tsc --noEmit -p tsconfig.json. Type-level only; there is no runtime.
 */

import type { BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins";
import { Effect, Layer, Option } from "effect";
import { makeAuth } from "../src/Auth.ts";
import { makeBoundary } from "../src/Boundary.ts";
import { Database, Mail, SecondaryStore, type SecondaryStoreService } from "../src/Contract.ts";

const adaptStore = (
  store: SecondaryStoreService,
  run: {
    fn: <A extends readonly unknown[], B, E>(
      b: (...a: A) => Effect.Effect<B, E, never>,
    ) => (...a: A) => Promise<B>;
  },
) => ({
  get: run.fn((key: string) => store.get(key)),
  set: run.fn((key: string, value: string, ttl?: number) => store.set(key, value, ttl)),
  delete: run.fn((key: string) => store.delete(key)),
});

const authOptions = Effect.gen(function* () {
  const database = yield* Database;
  const run = yield* makeBoundary<never>();

  // The claim under test: this does NOT add SecondaryStore to R.
  const store = yield* Effect.serviceOption(SecondaryStore);

  return {
    database: database.betterAuthDatabase,
    ...(Option.isSome(store) ? { secondaryStorage: adaptStore(store.value, run) } : {}),
  } satisfies BetterAuthOptions;
});

/** ASSERTION 1: R is exactly `Database`. SecondaryStore is absent. */
type R = Effect.Services<typeof authOptions>;
type Required = Database;
const _rIsExact: [R extends Required ? true : false, Required extends R ? true : false] = [
  true,
  true,
];
void _rIsExact;

/** ASSERTION 2: SecondaryStore specifically is NOT in R. */
const _storeNotRequired: SecondaryStore extends R ? false : true = true;
void _storeNotRequired;

/**
 * ASSERTION 3: it still composes with `makeAuth`, and the three required tags
 * are the only thing the host has to provide.
 */
declare const someLayer: Layer.Layer<Database>;
const built = makeAuth(authOptions).pipe(Effect.provide(someLayer));
void built;

/** ASSERTION 4: Mail is untouched by any of this (control — it IS in R when used). */
const withMail = Effect.gen(function* () {
  const mail = yield* Mail;
  void mail;
  return {} satisfies BetterAuthOptions;
});
const _mailIsRequired: Mail extends Effect.Services<typeof withMail> ? true : false = true;
void _mailIsRequired;

const spreadWithPlugin = Effect.gen(function* () {
  const database = yield* Database;

  // Exactly the shape `Bae` would return.
  const base = { database: database.betterAuthDatabase };

  return {
    ...base,
    plugins: [admin()],
  } satisfies BetterAuthOptions;
});

declare const baseLayer: Layer.Layer<Database>;

/**
 * ASSERTION 5: after a spread, `auth.api` still carries the ADMIN plugin's
 * endpoints. If inference collapsed to `Auth<BetterAuthOptions>` these would be
 * gone and this line would fail.
 */
const provenPluginSurvival = Effect.gen(function* () {
  const cached = yield* makeAuth(spreadWithPlugin);
  const auth = yield* cached;
  const banUser = auth.api.setRole;
  const listUsers = auth.api.listUsers;
  return { banUser, listUsers };
}).pipe(Effect.provide(baseLayer));

void provenPluginSurvival;
