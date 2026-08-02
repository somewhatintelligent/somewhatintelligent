import { ALCHEMY_DEV, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { makeEffectAuth } from "better-auth-effect";
import * as Effect from "effect/Effect";

import { ingress } from "../ingress.ts";
import { live } from "./capabilities.ts";
import { authConfig } from "./config.ts";
import { AUTH_COOKIE_DOMAIN, AUTH_ORIGIN } from "./origin.ts";
import { authRpc } from "./rpc.ts";

const addressing = Effect.gen(function* () {
  const { stage } = yield* Stack;
  return ingress(stage, yield* ALCHEMY_DEV);
});

export default class AuthWorker extends Cloudflare.Worker<AuthWorker>()(
  "AuthWorker",
  {
    main: import.meta.url,
    url: false,
    observability: { enabled: true },
    compatibility: { flags: ["nodejs_compat"] },
    env: {
      [AUTH_ORIGIN]: Effect.map(addressing, (at) => at.origin),
      [AUTH_COOKIE_DOMAIN]: Effect.map(addressing, (at) => at.cookieDomain ?? ""),
    },
  },
  Effect.gen(function* () {
    const auth = yield* makeEffectAuth(authConfig);
    const methods = yield* Effect.fnUntraced(authRpc)(auth);

    if (Object.hasOwn(methods, "fetch")) {
      const collision = new TypeError(
        "an RPC method is named `fetch`, which is the Worker's Main slot and holds Better " +
          "Auth's handler. Installing it there would route every /api/auth/* request to that " +
          "method instead. Rename it.",
      );
      return yield* Effect.flatMap(Effect.logError(collision.message), () => Effect.die(collision));
    }

    return { ...methods, fetch: Effect.orDie(auth.http) };
  }).pipe(Effect.provide(live)),
) {}
