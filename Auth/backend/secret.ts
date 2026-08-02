import { Random } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

/**
 * What Better Auth signs every session cookie and JWT with. Unset, it falls
 * back to a constant compiled into the package that anyone can read.
 *
 * `Random` persists the value in stack state, so replacing this resource
 * invalidates every live session.
 */
export const AuthSecret = Effect.gen(function* () {
  const store = yield* Cloudflare.SecretsStore.Store("AuthSecrets");
  const value = yield* Random("BetterAuthSecretValue");
  return yield* Cloudflare.SecretsStore.Secret("BetterAuthSecret", { store, value: value.text });
});
