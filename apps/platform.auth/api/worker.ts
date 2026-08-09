import { ALCHEMY_DEV, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { makeEffectAuth } from "lib.better-auth-effect";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";
import { PRODUCTION_ZONE } from "platform.names";

import { ingress } from "../shared/ingress.ts";
import { mezesAudience, mezesOrigin } from "../shared/resources.ts";
import { live } from "./capabilities.ts";
import { authConfig } from "./config.ts";
import { AuthEmail } from "./email/Mail.ts";
import { AUTH_COOKIE_DOMAIN, AUTH_ORIGIN } from "./origin.ts";
import { encodeAudiences, OAUTH_RESOURCES } from "./resources.ts";
import { deadline, orDieLogged, step, traced } from "./observe.ts";
import { authRpc } from "./rpc.ts";

const addressing = Effect.gen(function* () {
  const { stage } = yield* Stack;
  return ingress(stage, yield* ALCHEMY_DEV);
});

/**
 * The protected resources this stage will mint audience-bound tokens for.
 *
 * `MEZES_ORIGIN` is how a stage names a mezes that is not derivable — every
 * stage but production, where mezedes sits on a `*.workers.dev` name alchemy
 * derives. Set it to the ORIGIN, not the MCP URL: the `/mcp` suffix is part of
 * the resource identifier and `shared/resources.ts` is what appends it, so the
 * two sides cannot drift.
 *
 * A value that is not an origin DIES rather than resolving to no resource.
 * Silently dropping it would deploy a stage that answers discovery, accepts a
 * registration, runs the whole browser flow, and only then hands back a token
 * mezes cannot read — a failure four steps from its cause. An operator who set
 * the variable meant it.
 */
const resources = Effect.gen(function* () {
  const { stage } = yield* Stack;
  const declared = yield* Config.string("MEZES_ORIGIN").pipe(Config.withDefault(""));
  /**
   * The SAME variable mezedes' own stack reads, so a zone move carries both
   * sides. Ignored entirely once `MEZES_ORIGIN` is set — that names the origin
   * outright and there is nothing left to derive.
   */
  const zone = yield* Config.string("MEZEDES_ZONE").pipe(Config.withDefault(PRODUCTION_ZONE));
  const origin = declared === "" ? mezesOrigin(stage, zone) : declared;
  if (origin === null) return [];

  const audience = mezesAudience(origin);
  return audience === null
    ? yield* Effect.die(
        new Error(`MEZES_ORIGIN is ${JSON.stringify(declared)}, which is not an http(s) origin.`),
      )
    : [audience];
}).pipe(Effect.orDie);

export default class AuthWorker extends Cloudflare.Worker<AuthWorker>()(
  "AuthWorker",
  {
    main: import.meta.url,
    workersDev: false,
    observability: { enabled: true },
    compatibility: { flags: ["nodejs_compat"] },
    env: {
      [AUTH_ORIGIN]: Effect.map(addressing, (at) => at.origin),
      [AUTH_COOKIE_DOMAIN]: Effect.map(addressing, (at) => at.cookieDomain ?? ""),
      [OAUTH_RESOURCES]: Effect.map(resources, encodeAudiences),
      /**
       * Cloudflare Email Service, unrestricted — auth writes to strangers, so
       * no destination allowlist. The sender must sit on a domain onboarded to
       * Email Sending or every send is refused; see `email/Mail.ts`.
       */
      EMAIL: AuthEmail,
      ...serviceName("auth"),
    },
  },
  Effect.gen(function* () {
    /**
     * NAMED STEPS, because the failure that produced this was a hang: the
     * runtime killed the isolate and printed `undefined`, so there was no way
     * to tell which of these never returned. Each one announces itself and
     * carries a deadline that turns silence into a logged failure.
     */
    const auth = yield* deadline(
      "resolve auth config",
      20,
      step("resolve auth config", makeEffectAuth(authConfig)),
    );
    const methods = yield* deadline(
      "build rpc surface",
      10,
      step("build rpc surface", Effect.fnUntraced(authRpc)(auth)),
    );

    if (Object.hasOwn(methods, "fetch")) {
      const collision = new TypeError(
        "an RPC method is named `fetch`, which is the Worker's Main slot and holds Better " +
          "Auth's handler. Installing it there would route every /api/auth/* request to that " +
          "method instead. Rename it.",
      );
      return yield* Effect.flatMap(Effect.logError(collision.message), () => Effect.die(collision));
    }

    /**
     * `orDieLogged`, never bare `orDie`. A request that fails here used to
     * become a defect with no record of what went wrong.
     */
    return { ...methods, fetch: orDieLogged("http handler", auth.http) };
  }).pipe(
    Effect.provide(Layer.mergeAll(live, telemetry())),
    /**
     * The outermost net. Layer construction happens inside `provide`, so a
     * capability that fails or hangs while being built is only visible from
     * out here.
     */
    (worker) => traced("worker startup", worker),
  ),
) {}
