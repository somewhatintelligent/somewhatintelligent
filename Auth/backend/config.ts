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
import { Gateway } from "./gateway.ts";

export const authConfig = Effect.gen(function* () {
  const bae = yield* Bae;
  const gateway = yield* Gateway;
  yield* makeRequestBoundary<never>();
  return yield* bae.configure({
    baseURL: gateway.origin,
    basePath: AUTH_BASE_PATH,
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
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      storeSessionInDatabase: true,
      cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "jwt" as const },
    },
  });
});

export type AuthConfig = Effect.Success<typeof authConfig>;
export type Auth = EffectAuth<AuthConfig, BaeConfigError>;
