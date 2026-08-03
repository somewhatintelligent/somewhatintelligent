/**
 * The boilerplate half of a Better Auth configuration, derived from the
 * capabilities rather than written out.
 *
 * ```ts
 * const options = Effect.gen(function* () {
 *   const bae = yield* Bae
 *   const run = yield* makeBoundary<Mail>()
 *
 *   return yield* bae.configure({
 *     appName: "acme",
 *     baseURL: "https://auth.acme.com",
 *     plugins: [admin()],
 *     emailAndPassword: {
 *       enabled: true,
 *       sendResetPassword: run.fn((data) => …),
 *     },
 *   })
 * })
 * ```
 *
 * `database` and `secondaryStorage` stop being things you write, and the keys
 * that have to MERGE — `plugins`, `advanced`, `rateLimit.customStorage` — are
 * merged rather than clobbered. See {@link Bae.configure} for which side wins on
 * each, and for why it is a call rather than an object to spread — some
 * combinations are refused, and only `configure` can see them.
 *
 * `baseURL`, `trustedOrigins` and `secret` are NOT here, deliberately. They are
 * ordinary deployment values with established practices — on alchemy,
 * `Cloudflare.Worker.URL` and `Config.redacted` yielded in the init phase — and
 * a capability supplying them narrowed what a deployment could express rather
 * than freeing it.
 *
 * ## Inference survives, and that is not obvious
 *
 * Better Auth recovers every plugin's endpoints and models from the *literal
 * type* of the options object, and this package has lost that surface silently
 * three times. So "does this shape survive inference?" is a real question, not
 * a stylistic one.
 *
 * It does, and it is measured rather than assumed. `scripts/probe-optional-
 * wiring.ts` asserts `auth.api.setRole` and `auth.api.listUsers` are reachable
 * through `makeAuth`; `scripts/probe-plugin-widening.ts` asserts the user model
 * widens with `role` and `banned`, against a control that reproduces the
 * failure. Both are mutation-tested: annotating the config as
 * `Effect<BetterAuthOptions, …>` makes every one of those disappear.
 *
 * You no longer write `satisfies BetterAuthOptions` — `configure`'s parameter
 * is constrained, so the check happens whether or not you remember it.
 *
 * ## Optional capabilities are plain keys, not conditional spreads
 *
 * {@link SecondaryStore} is read with `Effect.serviceOption`, so it does NOT
 * enter the requirement channel: a deployment that wants sessions in the
 * database simply does not provide the Layer, and that is a legitimate choice
 * rather than a mistake.
 *
 * The key is always present and set to `undefined` when the capability is
 * absent, because Better Auth cannot distinguish `secondaryStorage: undefined`
 * from an omitted key — measured, not assumed.
 *
 * It is worth knowing what that costs: providing `SecondaryStore` REMOVES the
 * `session` and `verification` tables from the generated schema, so the
 * capability set is part of your schema, not just your runtime. A missing Layer
 * changes the tables and raises no error. Deploy-time schema generation must
 * therefore see the same capability set the Worker does.
 */

import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { captcha } from "better-auth/plugins";
import { Effect, Option } from "effect";
import { makeBoundary } from "./Boundary.ts";
import {
  type BaeConfigError,
  CapabilityPluginConflict,
  RateLimitStorageConflict,
} from "./ConfigError.ts";
import {
  Captcha,
  Database,
  type RateLimitRow,
  RateLimitStorage,
  SecondaryStore,
} from "./Contract.ts";

/**
 * The options you still write — every Better Auth option except the ones a
 * capability supplies outright.
 *
 * `database` comes from {@link Database}; `secondaryStorage` from
 * {@link SecondaryStore} and `rateLimit.customStorage` from
 * {@link RateLimitStorage} when their Layers are in scope. Passing one of them
 * is a compile error rather than a silent override, because the alternative is
 * a deployment whose Worker and whose schema generation disagree about what the
 * capability set is.
 *
 * `baseURL`, `trustedOrigins` and `secret` are yours and are not touched.
 *
 * `rateLimit` is otherwise untouched. Where the state lives is a substrate
 * question and belongs to a capability; `enabled`, `window`, `max`,
 * `customRules` and `storage` are policy and stay yours. `storage: "database"`
 * remains the way to ask Better Auth for its own table.
 */
export type BaeOptions = Omit<BetterAuthOptions, "database" | "secondaryStorage" | "rateLimit"> & {
  readonly rateLimit?: Omit<NonNullable<BetterAuthOptions["rateLimit"]>, "customStorage">;
};

/** The keys {@link Bae.configure} fills in. */
export interface BaeSupplied {
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly secondaryStorage: BetterAuthOptions["secondaryStorage"];
  readonly rateLimit: BetterAuthOptions["rateLimit"];
}

/**
 * What `yield* Bae` gives you.
 *
 * Shares its name with the value below, the way a `Context.Service` class is
 * both a type and the thing you yield — so `const bae = yield* Bae` gives you
 * a `Bae`, and there is one name to remember rather than two.
 */
export interface Bae {
  /**
   * Your options, with the parts your capabilities supply merged in.
   *
   * ```ts
   * return yield* bae.configure({ appName: "acme", plugins: [admin()] })
   * ```
   *
   * ## What it merges, and which side wins
   *
   * | key                      | rule                                      |
   * | ------------------------ | ----------------------------------------- |
   * | `plugins`                | capability plugins FIRST, then yours      |
   * | `rateLimit.customStorage`| {@link RateLimitStorage}'s, if in scope   |
   * | everything else          | yours, untouched                          |
   *
   * Capability plugins go first so a {@link Captcha} challenge is checked
   * before another plugin's request hook runs.
   *
   * ## It is an Effect, because some combinations are refused
   *
   * A combination that typechecks can still be incoherent, and only `configure`
   * can see it — the check depends on which capability Layers are in scope,
   * which is exactly what `Effect.serviceOption` hides from the type. Those
   * fail with a {@link BaeConfigError}, so `Effect.catchTag` can name one.
   *
   * Nothing is checked until the options are built: once per isolate, and once
   * on the deploy host, which resolves this same module to generate the schema.
   * The deploy fails first, which is the right order.
   *
   * ## The capability plugins are absent from the return type
   *
   * `O` is your options exactly; the plugins {@link Captcha} adds are in the
   * returned VALUE but not in its type. That is deliberate rather than a
   * limitation: which capabilities a deployment provides is not knowable from
   * the type — `Effect.serviceOption` is what makes them optional — and the
   * auto-wired plugins contribute no models and no endpoints. Captcha adds
   * three `$ERROR_CODES` and nothing else. Naming them would mean claiming a
   * presence the type cannot know, to gain three keys.
   */
  readonly configure: <O extends BaeOptions>(
    options: O,
  ) => Effect.Effect<O & BaeSupplied, BaeConfigError>;
}

/**
 * `Effect<Bae, never, Database>` — yield it like a tag.
 *
 * `Database` is the only thing every configuration must have. `SecondaryStore`,
 * `Captcha` and `RateLimitStorage` are read optionally, so each appears when its
 * Layer is provided without every deployment being forced to supply one.
 */
export const Bae: Effect.Effect<Bae, never, Database> = Effect.gen(function* () {
  const database = yield* Database;
  const store = yield* Effect.serviceOption(SecondaryStore);
  const challenge = yield* Effect.serviceOption(Captcha);
  const limits = yield* Effect.serviceOption(RateLimitStorage);

  // The store's methods return Effects and Better Auth wants promises. Its
  // services require nothing, so an empty boundary is enough to bridge them.
  const run = yield* makeBoundary<never>();

  /** The plugins the capabilities in scope imply. Empty is the common case. */
  const wired: BetterAuthPlugin[] = Option.match(challenge, {
    onNone: () => [],
    onSome: (c) => [
      captcha({
        provider: c.provider,
        secretKey: c.secretKey,
        ...(c.endpoints === undefined ? {} : { endpoints: [...c.endpoints] }),
      }),
    ],
  });

  const secondaryStorage = Option.getOrUndefined(
    Option.map(store, (secondary) => ({
      get: run.fn((key: string) => secondary.get(key)),
      set: run.fn((key: string, value: string, ttl?: number) => secondary.set(key, value, ttl)),
      delete: run.fn((key: string) => secondary.delete(key)),
      ...(secondary.getAndDelete === undefined
        ? {}
        : { getAndDelete: run.fn((key: string) => secondary.getAndDelete!(key)) }),
      ...(secondary.increment === undefined
        ? {}
        : { increment: run.fn((key: string, ttl: number) => secondary.increment!(key, ttl)) }),
    })),
  );

  // The key set is mirrored, not filled in: Better Auth branches on whether
  // `consume` is there, and a stub would claim atomicity KV cannot give.
  const customStorage = Option.getOrUndefined(
    Option.map(limits, (storage) => ({
      get: run.fn((key: string) => storage.get(key)),
      set: run.fn((key: string, value: RateLimitRow, update?: boolean) =>
        storage.set(key, value, update),
      ),
      ...(storage.consume === undefined
        ? {}
        : {
            consume: run.fn((key: string, rule: { window: number; max: number }) =>
              storage.consume!(key, rule),
            ),
          }),
    })),
  );

  const wiredIds = new Set(wired.map((plugin) => plugin.id));

  return {
    configure: <O extends BaeOptions>(options: O): Effect.Effect<O & BaeSupplied, BaeConfigError> =>
      Effect.gen(function* () {
        const clash = (options.plugins ?? []).find((plugin) => wiredIds.has(plugin.id));
        if (clash !== undefined) {
          return yield* new CapabilityPluginConflict({ id: clash.id });
        }

        const storage = options.rateLimit?.storage;
        if (customStorage !== undefined && storage !== undefined) {
          return yield* new RateLimitStorageConflict({ storage });
        }

        return {
          ...options,
          database: database.betterAuthDatabase,
          secondaryStorage,
          plugins: [...wired, ...(options.plugins ?? [])],
          rateLimit:
            customStorage === undefined
              ? options.rateLimit
              : { ...options.rateLimit, customStorage },
        };
      }),
  };
});
