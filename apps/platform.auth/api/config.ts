import { Bae, EmailTemplates, Mail, makeRequestBoundary } from "lib.better-auth-effect";
import type { BaeConfigError, EffectAuth } from "lib.better-auth-effect";

import { deliverWith } from "./email/deliver.ts";

import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { stripe } from "@better-auth/stripe";
import { PURCHASABLE_PLANS } from "platform.entitlements";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { AUTH_BASE_PATH } from "../shared/ingress.ts";
import { Billing, refusingClient } from "./billing.ts";
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
  /**
   * The Stripe account, resolved here for the same reason as the three above:
   * it is a capability the configuration is built FROM, and it has to answer on
   * the deploy host too — see `api/billing.ts`.
   */
  const billing = yield* Billing;
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
        scopes: ["openid", "profile", "email", "offline_access"],
        allowPublicClientPrelogin: true,
        customUserInfoClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
        customIdTokenClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
      }),
      /**
       * SUBSCRIPTIONS, against the same Stripe account the store settles on.
       *
       * MOUNTED UNCONDITIONALLY, even where `billing.configured` is `false`, and
       * that is the single most important line in this block. The plugin's
       * schema — the `subscription` table and `user.stripeCustomerId` — is
       * derived from these options by the generator on the deploy host, so
       * mounting it only when a secret is present would make the DATABASE SHAPE
       * depend on a secret: a stage without the key would generate a schema with
       * no `subscription` table, and `drizzle-kit` would dutifully emit a
       * migration DROPPING it. Endpoints that refuse are recoverable. A dropped
       * table is not.
       *
       * NO `authorizeReference`, and its absence is load-bearing rather than an
       * omission. With no organization billing, a subscription's reference id is
       * always the caller's own user id, and the plugin's `referenceMiddleware`
       * REFUSES any explicit `referenceId` that is not the session's own when no
       * `authorizeReference` is configured. Writing one would replace a deny by
       * default with a predicate that has to be right — for five actions,
       * forever. See `packages/stripe/src/middleware.ts` upstream.
       *
       * `limits` is not set on any plan either; entitlements come from
       * `platform.entitlements`, never off the wire. The reasoning is in that
       * package's `Catalog.ts`.
       */
      stripe({
        /**
         * THE ONE SEAM THAT STRUCTURALLY DEMANDS A CLIENT, which is why the
         * refusal is built here rather than carried on the capability: the
         * service says `Option.none()` and means it, and nothing else can pick
         * up a client that would throw.
         */
        stripeClient: Option.match(billing.account, {
          onNone: refusingClient,
          onSome: (account) => account.client,
        }),
        stripeWebhookSecret: Option.match(billing.account, {
          onNone: () => "",
          onSome: (account) => Redacted.value(account.webhookSecret),
        }),
        /**
         * Only where there is an account to create one in. The plugin swallows
         * failures in this hook — a sign-up must not fail because Stripe is
         * down — so leaving it on with a refusing client would turn every
         * sign-up into a logged error that means nothing.
         */
        createCustomerOnSignUp: Option.isSome(billing.account),
        subscription: {
          enabled: true,
          plans: [...PURCHASABLE_PLANS],
          /**
           * The one place this deployment is stricter than sign-in, which does
           * not require verification. A 14-day trial handed to an unverified
           * address is a trial farm: the plugin's own abuse prevention is
           * per-CUSTOMER, and an unverified address mints a fresh customer every
           * time. Verification is the cheapest thing that makes that cost
           * something.
           */
          requireEmailVerification: true,
        },
        /**
         * ORGANIZATION BILLING IS OFF, deliberately, even though the
         * organization plugin runs. Nothing sells to an organisation yet, and
         * `allowUserToCreateOrganization` is `false`, so switching it on would
         * add an `organization.stripeCustomerId` column and a seat-sync hook
         * serving nobody. Turning it on later is one nullable column — cheap,
         * and cheaper than removing it.
         */
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
