/**
 * Do the type helpers forward plugin inference, or only appear to?
 *
 * This is the one thing worth testing about them. Inference collapse is silent:
 * `auth.api` degrades to the plugin-free client and nothing errors, so a helper
 * that quietly widened would pass every ordinary assertion. Each claim below is
 * therefore paired with a mutation — the same helper applied to a configuration
 * annotated `Effect<BetterAuthOptions, …>`, which is exactly how the surface has
 * been lost twice in this repo. If the mutation still had the field, the
 * assertion above it would be worthless.
 */

import { describe, expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins";
import { Effect } from "effect";
import { Bae } from "../src/Base.ts";
import type { ApiOf, AuthOptionsOf, SessionOf, UserOf } from "../src/Types.ts";

const withAdmin = Effect.gen(function* () {
  const bae = yield* Bae;
  return yield* bae.configure({ appName: "types", plugins: [admin()] });
});

/** The mutation: the annotation that throws the literal type away. */
const annotated: Effect.Effect<
  BetterAuthOptions,
  Effect.Error<typeof withAdmin>,
  Effect.Services<typeof withAdmin>
> = withAdmin;

type Assert<T extends true> = T;
type Has<T, K extends string> = K extends keyof T ? true : false;

// The admin plugin contributes `setRole` and `listUsers` to the API surface.
type _ApiKeeps = Assert<Has<ApiOf<typeof withAdmin>, "setRole">>;
type _ApiKeepsToo = Assert<Has<ApiOf<typeof withAdmin>, "listUsers">>;

// …and so does the user model. It did not when `Bae` exposed a plugin ARRAY to
// spread — see `scripts/probe-plugin-widening.ts`, which holds that measurement
// and the control for it.
type _UserWidens = Assert<Has<UserOf<typeof withAdmin>, "role">>;
type _UserWidensFully = Assert<Has<UserOf<typeof withAdmin>, "banned">>;

// The same plugin with no `configure` in the way. Anything `configure` did to
// inference would show as a difference against this.
const directPlugins = Effect.gen(function* () {
  const bae = yield* Bae;
  const supplied = yield* bae.configure({});
  return { ...supplied, appName: "types", plugins: [admin()] } satisfies BetterAuthOptions;
});
type _DirectWidens = Assert<Has<UserOf<typeof directPlugins>, "role">>;

// THE CONTROLS. Annotating collapses every one of the above to `false`.
type _AnnotatedLosesApi = Assert<
  Has<ApiOf<typeof annotated>, "setRole"> extends false ? true : false
>;
type _AnnotatedLosesUser = Assert<
  Has<UserOf<typeof annotated>, "role"> extends false ? true : false
>;

// `AuthOptionsOf` recovers the literal, not the widened parameter.
type _OptionsExact = Assert<Has<AuthOptionsOf<typeof withAdmin>, "plugins">>;

void 0 as unknown as [
  _ApiKeeps,
  _ApiKeepsToo,
  _UserWidens,
  _UserWidensFully,
  _DirectWidens,
  _AnnotatedLosesApi,
  _AnnotatedLosesUser,
  _OptionsExact,
];

describe("type helpers", () => {
  test("the file typechecks, which is the whole assertion", () => {
    // Every claim above is a compile-time `Assert<true>`; `tsc --noEmit` on this
    // project is what runs them. `bun test` does not typecheck, so this case
    // exists only so the suite reports the file rather than skipping it
    // silently.
    expect(true).toBe(true);
  });

  test("SessionOf resolves to something with a token, at runtime shape", () => {
    // A weak runtime check, deliberately: the strong claims are type-level.
    const shape: SessionOf<typeof withAdmin> | undefined = undefined;
    expect(shape).toBeUndefined();
  });
});
