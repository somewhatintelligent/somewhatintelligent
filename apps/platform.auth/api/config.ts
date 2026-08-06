import { Bae, EmailTemplates, Mail, makeRequestBoundary } from "lib.better-auth-effect";
import type { BaeConfigError, EffectAuth } from "lib.better-auth-effect";

import { deliverWith } from "./email/deliver.ts";

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

import { AUTH_BASE_PATH } from "../shared/ingress.ts";
import { Signing } from "./capabilities.ts";
import { Origin } from "./origin.ts";
import { allocateUsername, USERNAME_LIMITS } from "./username.ts";

/**
 * The one adapter method this needs. Better Auth's adapter types `findMany`
 * generically over the model, so the hook narrows in one place rather than
 * restating the whole surface.
 */
interface UserLookup {
  findMany: (query: unknown) => Promise<ReadonlyArray<Record<string, unknown>>>;
}

/**
 * The scopes this server grants, and the claims discovery advertises for them.
 *
 * Together rather than inline because `advertisedMetadata.claims_supported`
 * REPLACES the plugin's derived list (see its use below), so this file has to
 * restate what the plugin would have computed — and what it computes depends on
 * `AUTH_SCOPES`. Splitting them puts a derivation and its input in two places.
 *
 * `OIDC_CLAIMS` is exactly the plugin's own rule for `AUTH_SCOPES`: eight
 * unconditional claims, plus `email`/`email_verified` because `email` is
 * granted, plus the four profile claims because `profile` is.
 * `test/scopes.test.ts` pins both against the resolved configuration, so
 * changing one and forgetting the other fails before it reaches discovery.
 */
export const AUTH_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

const OIDC_CLAIMS = [
  "sub",
  "iss",
  "aud",
  "exp",
  "iat",
  "sid",
  "scope",
  "azp",
  "email",
  "email_verified",
  "name",
  "picture",
  "family_name",
  "given_name",
] as const;

/** Injected by `customIdTokenClaims` / `customUserInfoClaims` below. */
const CUSTOM_CLAIMS = ["role"] as const;

/** What `databaseHooks.user.create.before` is handed. */
type NewUser = Record<string, unknown>;
interface CreateContext {
  readonly context?: { readonly adapter?: unknown };
}

export const authConfig = Effect.gen(function* () {
  const bae = yield* Bae;
  const { origin, cookieDomain } = yield* Origin;
  const { secret } = yield* Signing;
  /**
   * Resolved HERE, beside `Origin` and `Signing`, because they are the same
   * kind of thing: capabilities the configuration is built from, not state a
   * request carries. `deliver` then closes over the clients and the boundary
   * keeps carrying `never`.
   */
  const deliver = deliverWith(yield* Mail, yield* EmailTemplates, origin);
  const run = yield* makeRequestBoundary<never>();
  return yield* bae.configure({
    /** See `api/secret.ts` for what happens when this is omitted. */
    secret,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    /** Production alone has a cookie domain — see `Ingress.cookieDomain`. */
    ...(cookieDomain === null
      ? {}
      : { advanced: { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: run.fn(({ user, url }) =>
        deliver("reset-password", user.email, { url, email: user.email, expiresIn: "1 hour" }),
      ),
    },
    emailVerification: {
      sendVerificationEmail: run.fn(({ user, url }) =>
        deliver("verify-email", user.email, { url, email: user.email, expiresIn: "1 hour" }),
      ),
    },
    plugins: [
      username(USERNAME_LIMITS),
      jwt({ disableSettingJwtHeader: true }),
      admin({ defaultRole: "user", impersonationSessionDuration: 60 * 20 }),
      twoFactor({
        issuer: "somewhatintelligent",
        otpOptions: {
          period: 30,
          digits: 6,
          sendOTP: run.fn(({ user, otp }) =>
            deliver("two-factor-otp", user.email, {
              otp,
              email: user.email,
              expiresIn: "30 seconds",
            }),
          ),
        },
      }),
      bearer(),
      passkey(),
      deviceAuthorization({ verificationUri: "/device" }),
      apiKey(),
      magicLink({
        sendMagicLink: run.fn(({ email, url }) =>
          deliver("magic-link", email, { url, email, expiresIn: "5 minutes" }),
        ),
      }),
      oauthProvider({
        loginPage: `/sign-in`,
        consentPage: `/consent`,
        scopes: [...AUTH_SCOPES],
        allowPublicClientPrelogin: true,
        /**
         * RFC 7591 registration, for SIGNED-IN callers only.
         *
         * Off by default upstream, which left `/oauth2/register` mounted and
         * answering 403 to everyone, and `registration_endpoint` absent from
         * discovery — so no spec-following client would ever have tried.
         *
         * `allowUnauthenticatedClientRegistration` is deliberately NOT set
         * beside it, and the omission is the security decision in this file.
         * With it, anyone may mint a client, and `client_name` — which the
         * caller supplies — is the only thing `_auth/consent.tsx` shows a user
         * before they grant scopes. That is consent phishing with the server's
         * own screen. The upstream guards bound what such a client could then
         * do (public only, no secret, `client_credentials` refused, PKCE
         * mandatory, `skip_consent` rejected outright) but none of them bound
         * what it can CLAIM TO BE, which is the part a user acts on.
         *
         * MCP wants the flag and it should eventually be on: until then an MCP
         * client takes a `client_id` registered here once, by hand. Turning it
         * on is a one-line change AFTER the consent screen distinguishes a
         * self-registered client from a trusted one.
         *
         * Registration is rate limited 5/60s per IP by the plugin itself, so
         * nothing below adds a rule for it.
         */
        allowDynamicClientRegistration: true,
        /**
         * The plugin cannot see the host's routing table, so it warns at every
         * boot that `/.well-known/oauth-authorization-server/api/auth` may not
         * be reachable. It now is — `servedByAuth` forwards it — and
         * `integ/oauth-provider.integ.test.ts` asserts a 200 there through the
         * real ingress. Silenced against that evidence and nothing weaker; a
         * warning nobody can act on is one everybody learns to scroll past.
         */
        silenceWarnings: { oauthAuthServerConfig: true },
        /**
         * The advertised claims, RESTATED IN FULL rather than added to.
         *
         * The docs say claims here are "in addition to the internally supported
         * claims". They are not: upstream reads
         * `advertisedMetadata?.claims_supported ?? claims ?? []`, so naming
         * `role` alone REPLACES the fourteen the plugin derives from `scopes`
         * and discovery goes from advertising all of them to advertising one.
         * Measured against a running server, not reasoned about — and the first
         * version of this line shipped exactly that regression.
         *
         * So the derived set has to be repeated beside the custom one. Both are
         * `OIDC_CLAIMS` / `CUSTOM_CLAIMS` above, next to the `scopes` that
         * determine them, because the two lists move together.
         */
        advertisedMetadata: { claims_supported: [...OIDC_CLAIMS, ...CUSTOM_CLAIMS] },
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
        sendInvitationEmail: run.fn((data) =>
          deliver("organization-invitation", data.email, {
            url: `${origin}${AUTH_BASE_PATH}/accept-invitation/${data.id}`,
            organization: data.organization.name,
            invitedBy: data.inviter.user.name || data.inviter.user.email,
            expiresIn: "7 days",
          }),
        ),
      }),
    ],
    /**
     * `database` storage is what creates the `rate_limit` table production
     * already has. The per-route rules are si's, carried over verbatim: a
     * global 100/60s would let an attacker spend the whole budget guessing at
     * `/sign-in/email`.
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
     * `before`, so the value lands in the same insert: an `after` hook would
     * leave a window where the row exists with no username, and a failure in it
     * would strand the account that way permanently.
     *
     * Only when the caller supplied none — an explicit username outranks
     * anything derived here. The plugin's own hook runs BEFORE this one and
     * passes an absent username straight through, so nothing downstream
     * validates what this produces; it has to be valid by construction, which
     * is what `username.ts` is for.
     */
    databaseHooks: {
      user: {
        create: {
          before: run.fn((user: NewUser, ctx: CreateContext | null) =>
            Effect.gen(function* () {
              if (typeof user.username === "string" && user.username !== "") return undefined;
              const adapter = ctx?.context?.adapter as UserLookup | undefined;
              // No adapter is no way to know a name is free, and `username` is
              // UNIQUE — guessing would turn a collision into a failed sign-up.
              if (adapter === undefined) return undefined;
              const email = typeof user.email === "string" ? user.email : "";

              const allocated = yield* Effect.promise(() =>
                allocateUsername(email, {
                  taken: async (candidates) => {
                    const rows = await adapter.findMany({
                      model: "user",
                      where: [{ field: "username", value: candidates, operator: "in" }],
                    });
                    return rows
                      .map((row) => row.username)
                      .filter((name): name is string => typeof name === "string");
                  },
                }),
              );
              if (allocated === null) return undefined;

              return { data: { ...user, ...allocated } };
            }),
          ),
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
