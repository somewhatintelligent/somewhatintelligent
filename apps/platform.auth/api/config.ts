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
import { SCOPE_NAMES } from "../shared/scopes.ts";
import { Signing } from "./capabilities.ts";
import { Origin } from "./origin.ts";
import { Resources } from "./resources.ts";
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
 * The claims discovery advertises.
 *
 * Written out because `advertisedMetadata.claims_supported` REPLACES the
 * plugin's derived list (see its use below), so this file has to restate what
 * the plugin would have computed — and what it computes depends on the scopes
 * in `shared/scopes.ts`.
 *
 * `OIDC_CLAIMS` is exactly the plugin's own rule for that list: eight
 * unconditional claims, plus `email`/`email_verified` because `email` is
 * granted, plus the four profile claims because `profile` is. The mezes scopes
 * add none — they are not OIDC scopes and carry no claims of their own.
 * `test/oauth-provider.test.ts` pins the whole set against the resolved
 * configuration, so granting a scope and forgetting its claims fails before it
 * reaches discovery.
 */
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
  const { audiences } = yield* Resources;
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
    advanced: {
      /**
       * WHO A RATE LIMIT COUNTS AGAINST. Without this Better Auth cannot
       * resolve a client address and falls back to ONE SHARED BUCKET PER PATH,
       * which turns every rule below into a denial-of-service tool: three failed
       * logins from anyone, anywhere, and `/sign-in/email` is shut for everybody
       * for ten seconds. Found by running the integration suite and reading the
       * warning it printed, not by reasoning about the config.
       *
       * `cf-connecting-ip` ALONE. Cloudflare's edge sets it and a client cannot
       * forge it; `x-forwarded-for` is client-supplied on the way in, so
       * accepting it as a fallback would let an attacker mint a fresh bucket per
       * request and walk straight through the limit it is meant to enforce.
       *
       * It survives the service-binding hop from `app/worker.ts`, which passes
       * the request through with its headers — including the rewritten
       * discovery requests, which copy them. Locally there is no such header and
       * no meaningful client address either; the fallback is correct there.
       */
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      /** Production alone has a cookie domain — see `Ingress.cookieDomain`. */
      ...(cookieDomain === null
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
    },
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
        /**
         * See `shared/scopes.ts`: the same list the consent screen has words
         * for. Spread because the plugin takes a mutable array and the list is
         * `readonly` — nothing here should be able to push a scope onto it.
         */
        scopes: [...SCOPE_NAMES],
        /**
         * What a token may be MADE OUT TO. Naming this list at all replaces the
         * default — Better Auth otherwise accepts its own base URL and nothing
         * else — so the base URL is restated here rather than assumed. It has to
         * be: `/oauth2/userinfo` is addressed by it on every `openid` grant.
         *
         * A `resource` outside this list is refused at the token endpoint. That
         * refusal is the security property: it is what stops a client that
         * talked a user into consenting from pointing the resulting token at
         * some other service on the internet.
         */
        validAudiences: [`${origin}${AUTH_BASE_PATH}`, ...audiences],
        /**
         * RFC 7591 registration, open to callers with no credentials.
         *
         * MCP clients bring none and no operator either. A coding agent
         * discovers this server from mezes' protected-resource metadata,
         * registers itself, and runs the browser flow — all before any human
         * has seen a settings page, which is the entire reason there is nothing
         * to paste.
         *
         * The upstream guards bound what a self-registered client can DO:
         * `token_endpoint_auth_method` is forced to `"none"`, which makes it
         * public, which makes PKCE mandatory; `client_credentials` is refused
         * at registration; `skip_consent` is `z.never()` on that endpoint, so
         * it can never register its way past the screen. Registration by itself
         * grants nothing — only the person in the browser does.
         *
         * NONE OF THAT BOUNDS WHAT IT CAN CLAIM TO BE, which is the part a
         * person acts on: `client_name` is caller-supplied and it is the
         * headline of the consent screen. That is consent phishing with this
         * server's own page, and it is the reason this flag stayed off until
         * `_auth/consent.tsx` could tell a self-registered client from a
         * vouched-for one and say so above everything else. It can — see
         * `clientProvenance` in `api/rpc.ts`. Take that warning away and this
         * flag has to come off with it.
         */
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        /**
         * NO `client_credentials`, for anyone — including the clients an admin
         * creates by hand. Machine-to-machine callers here use API keys, so the
         * grant is a second, unused way to obtain a token that carries no user
         * and passes no consent screen. An unused path is an unwatched one.
         */
        grantTypes: ["authorization_code", "refresh_token"],
        allowPublicClientPrelogin: true,
        /**
         * Both documents are served, at the root of this origin, by
         * `app/worker.ts` — the plugin cannot know that and warns on every cold
         * start otherwise. `test/ingress.test.ts` is what keeps the claim true.
         */
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
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
         * `OIDC_CLAIMS` / `CUSTOM_CLAIMS` above.
         *
         * `scopes_supported` is deliberately NOT overridden beside it: it
         * defaults to the whole scope list, which is what a client needs to see
         * to know `mezes:write` can be asked for.
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
     *
     * `enabled` IS STATED. Better Auth infers it from `NODE_ENV === "production"`,
     * and nothing in this deploy sets `NODE_ENV` — alchemy's bundler defines
     * `globalThis.__ALCHEMY_RUNTIME__` and nothing else — so left inferred, every
     * rule below applies or does not according to a variable no one here
     * controls. That was survivable while the endpoints behind them all needed a
     * password to be interesting. `/oauth2/register` takes no credential at all
     * (see the OAuth provider above), and a rule that silently is not in force is
     * the failure this whole file is written in the style of.
     *
     * The cost is one storage round trip per request that reaches the auth
     * handler. Only `/api/auth/*` does.
     */
    rateLimit: {
      enabled: true,
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
