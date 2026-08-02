/**
 * The ways a configuration can be incoherent, in the failure channel.
 *
 * Two kinds of wrongness are already handled elsewhere and are NOT here:
 *
 * - **What you may not write** is a type error. `BaeOptions` omits `database`,
 *   `secondaryStorage` and `rateLimit.customStorage`, because each is a
 *   capability's to supply. `secret` and `baseURL` remain the consumer's.
 *   Nothing needs to check at run time what the compiler refuses.
 * - **What fails inside a Better Auth callback** throws, because it happens on
 *   a stack Better Auth owns and cannot be handed an `Effect`. That is
 *   `SuspendedInSyncPosition` and `NoRequestInScope` in `Boundary.ts`.
 *
 * What is left is the middle case: a combination that typechecks, that only
 * `configure` can see because it depends on which capability Layers are in
 * scope, and that no amount of care at the callsite would catch. Those go in
 * the failure channel, where `Effect.catchTag` can name one.
 *
 * ## Where they surface
 *
 * `configure` returns an `Effect`, so nothing is checked until the options are
 * built — which is once per isolate, and once on the deploy host when
 * `bae-alchemy` generates the schema from the same module. The deploy is
 * therefore the first thing to fail, which is the right order: a configuration
 * that cannot be coherent should not reach a Worker.
 *
 * `authWorker` ends in `Effect.orDie`, so in an isolate these become defects —
 * a 500 and a logged error rather than a silently degraded deployment.
 */

import { Data } from "effect";

/**
 * A `RateLimitStorage` Layer is in scope AND `rateLimit.storage` was written.
 *
 * Two answers to one question. Better Auth resolves it silently in favour of
 * `customStorage`, which is the half `bae` supplies — so the written `storage`
 * has no effect on where state goes, and if it said `"database"` the generated
 * schema gains a `rateLimit` table nothing will ever write to. `getAuthTables`
 * gates on `rateLimit.storage === "database"` exactly and does not look at
 * `customStorage`.
 *
 * Drop one: remove the `RateLimitStorage` Layer to use Better Auth's own
 * storage, or drop `storage` to use the capability's.
 */
export class RateLimitStorageConflict extends Data.TaggedError("RateLimitStorageConflict")<{
  readonly storage: "memory" | "database" | "secondary-storage";
}> {
  override get message(): string {
    return (
      `bae: a RateLimitStorage Layer is in scope and rateLimit.storage is "${this.storage}". ` +
      `Better Auth would use the Layer and ignore the setting, and "database" would ` +
      `additionally generate a table nothing writes to. Remove one of the two.`
    );
  }
}

/**
 * A plugin was passed whose id a capability already wired.
 *
 * Better Auth runs both, and for the case this exists to catch — a `Captcha`
 * Layer plus a hand-written `captcha()` — that means verifying the token
 * twice. Turnstile and hCaptcha tokens are single-use, so the second
 * verification fails and every challenged request is refused.
 */
export class CapabilityPluginConflict extends Data.TaggedError("CapabilityPluginConflict")<{
  readonly id: string;
}> {
  override get message(): string {
    return (
      `bae: the "${this.id}" plugin is both wired from a capability Layer and passed to ` +
      `configure. Better Auth would run both. Remove the Layer to configure it by hand, ` +
      `or remove the plugin to configure it from the capability.`
    );
  }
}

/** Every way {@link Bae.configure} can refuse. */
export type BaeConfigError = RateLimitStorageConflict | CapabilityPluginConflict;
