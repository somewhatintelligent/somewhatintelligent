import { Bae, makeRequestBoundary } from "better-auth-effect";
import type { BaeConfigError, EffectAuth } from "better-auth-effect";

import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";

import * as Effect from "effect/Effect";

import { AUTH_BASE_PATH } from "../ingress.ts";
import { Signing } from "./capabilities.ts";
import { Origin } from "./origin.ts";
import { allocateUsername } from "./username.ts";

/**
 * The one adapter method this needs. Better Auth's `GenericEndpointContext` is
 * exported but its adapter's `findMany` is generic over the model, so the hook
 * takes the inferred context and narrows in one place rather than restating it.
 */
interface UserLookup {
  findMany: (query: unknown) => Promise<ReadonlyArray<Record<string, unknown>>>;
}

export const authConfig = Effect.gen(function* () {
  const bae = yield* Bae;
  const { origin, cookieDomain } = yield* Origin;
  const { secret } = yield* Signing;
  yield* makeRequestBoundary<never>();
  return yield* bae.configure({
    /**
     * Better Auth signs every session cookie and every JWT with this. Omit it
     * and it falls back to a constant compiled into the package — see
     * `backend/secret.ts`.
     */
    secret,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    /**
     * Only production has a cookie domain — every other stage answers on
     * `*.workers.dev`, which browsers refuse to scope a cookie to. See
     * `Ingress.cookieDomain`.
     */
    ...(cookieDomain === null
      ? {}
      : { advanced: { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      username(),
      jwt({ disableSettingJwtHeader: true }),
      admin({ defaultRole: "user", impersonationSessionDuration: 60 * 20 }),
      twoFactor({ issuer: "somewhatintelligent", otpOptions: { period: 30, digits: 6 } }),
      bearer(),
      passkey(),
      deviceAuthorization({ verificationUri: "/device" }),
      apiKey(),
      magicLink({
        sendMagicLink() {
          throw new Error("not implemented");
        },
      }),
      oauthProvider({
        loginPage: `/sign-in`,
        consentPage: `/consent`,
        scopes: ["openid", "profile", "email", "offline_access"],
        allowPublicClientPrelogin: true,
        customUserInfoClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
        customIdTokenClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
      }),
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
      }),
    ],
    /**
     * `database` is what creates the `rate_limit` table production already has.
     * The per-route rules are si's, carried over verbatim: the endpoints worth
     * throttling are the ones that guess a credential, and a global 100/60s
     * would let an attacker spend the whole budget on `/sign-in/email`.
     */
    rateLimit: {
      storage: "database" as const,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/two-factor/*": { window: 10, max: 3 },
      },
    },
    /**
     * Give a new account the username its address implies.
     *
     * `before`, so the value is written in the same insert rather than as a
     * follow-up update — an `after` hook would leave a window where the row
     * exists with no username, and any failure in it would strand the account
     * in that state permanently.
     *
     * Only when the caller supplied none: sign-up can send an explicit
     * username, and that choice outranks anything derived here.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (typeof user.username === "string" && user.username !== "") return;
            const adapter = ctx?.context.adapter as UserLookup | undefined;
            // No adapter is no way to know a name is free, and `username` is
            // UNIQUE — guessing would turn a collision into a failed sign-up.
            if (adapter === undefined) return;
            const email = typeof user.email === "string" ? user.email : "";

            const allocated = await allocateUsername(email, {
              taken: async (candidates) => {
                const rows = await adapter.findMany({
                  model: "user",
                  where: [{ field: "username", value: candidates, operator: "in" }],
                });
                return rows
                  .map((row) => row.username)
                  .filter((name): name is string => typeof name === "string");
              },
            });
            if (allocated === null) return;

            return { data: { ...user, ...allocated } };
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      storeSessionInDatabase: true,
      cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "jwt" as const },
    },
  });
});

export type AuthConfig = Effect.Success<typeof authConfig>;
export type Auth = EffectAuth<AuthConfig, BaeConfigError>;
