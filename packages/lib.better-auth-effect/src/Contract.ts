/**
 * The capability surface: everything a Better Auth configuration can need from
 * the outside world, as Effect service tags.
 *
 * Nothing here knows what backs any of it. A configuration written against these
 * tags accumulates them in its requirement channel, and the host discharges them
 * with Layers. Swapping infrastructure is swapping a Layer; forgetting one is a
 * type error at the callback that reached for it.
 *
 * ## Database hands back a RESOLVED VALUE, never a coloured Effect
 *
 * The contract's `betterAuthDatabase` is exactly
 * `NonNullable<BetterAuthOptions["database"]>` — the value you would have passed
 * to `betterAuth({ database })` by hand.
 *
 * It is tempting to make it `Effect<BetterAuthDatabase, never, RuntimeContext>`
 * so a backing can resolve lazily. That is the one shape this package must not
 * have: `RuntimeContext` is alchemy's tag, and mentioning it here would make
 * `bae` depend on a deployment framework. The rule instead:
 *
 *   > A backing that must resolve per request or per invocation supplies a
 *   > FAÇADE whose methods resolve lazily. It does not put a coloured Effect in
 *   > the contract.
 *
 * Both halves are demonstrated. The plain case (a `bun:sqlite` handle, a D1
 * binding) needs no façade and served a full email+password flow live. The
 * hardest case — a Neon pool that only exists per Lambda invocation — is a
 * `PostgresPool` façade whose `connect()` resolves the invocation's pool, and it
 * satisfies the same shape.
 *
 * ## Is this contract substrate-agnostic, or quietly Cloudflare-shaped?
 *
 * Worth asking, since it was written against Cloudflare first. The strongest
 * evidence is the three OPTIONAL members on `SecondaryStore` and
 * `RateLimitStorage` — `getAndDelete`, `increment`, `consume`. They exist so a
 * substrate can CLAIM atomicity rather than have it assumed. Cloudflare KV
 * implements none of them; DynamoDB implements all three, so `consume` is a
 * conditional `UpdateItem` and the rate limit is actually enforced instead of
 * Better Auth's documented best-effort. A contract written to KV would not have
 * had that shape to offer.
 *
 * ## What belongs here
 *
 * Seven tags, and fewer is the healthy direction. Three tests, all of which a
 * candidate must pass:
 *
 *   1. **It exists on both sides of the deploy/runtime split.** The stack
 *      declares a resource and the Worker reaches it. A backing whose `live`
 *      and `inert` projections are the same Layer names no substrate, and is a
 *      value the deployment should write into its options directly.
 *   2. **A Better Auth option actually reaches it.** If no callback or config
 *      key consumes what the tag supplies, nothing can wire it.
 *   3. **It does not narrow the option it fills.** Better Auth's `baseURL` is a
 *      string OR `{ allowedHosts, protocol, fallback }`; a tag supplying only
 *      the string makes a documented upstream feature unreachable. A tag that
 *      costs a consumer reach is not a seam.
 *
 * `EmailTemplates` is deliberately separate from `Mail` under those rules: ten
 * sender callbacks exist across core and plugins, two of them are SMS, and
 * `twoFactor.otpOptions.sendOTP` supplies `{ user, otp }` with no channel at
 * all — so rendering keys on a touchpoint and the caller picks the transport.
 */

import type { BetterAuthOptions } from "better-auth";
import { Context, type Effect } from "effect";

// ── 1. Database — needs a deployed resource ─────────────────────────────────

export type SqlDialect = "sqlite" | "postgres" | "mysql" | "mssql";

/** Exactly what `betterAuth({ database })` accepts. Not narrowed, not wrapped. */
export type BetterAuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export interface DatabaseService {
  /** Drives schema generation and migration dialect selection. */
  readonly dialect: SqlDialect;
  /**
   * The resolved value handed to `betterAuth({ database })`.
   *
   * Resolved, never a coloured Effect — see the module doc. A backing needing
   * per-invocation resolution supplies a façade here.
   */
  readonly betterAuthDatabase: BetterAuthDatabase;
}
export class Database extends Context.Service<Database, DatabaseService>()("bae/Database") {}

// ── 2-3. Mail transport and template rendering are SEPARATE seams ─────────────

export class MailError extends Error {
  readonly _tag = "MailError";
}

export interface MailMessage {
  readonly to: ReadonlyArray<string>;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers?: Readonly<Record<string, string>>;
}
export interface MailService {
  readonly send: (message: MailMessage) => Effect.Effect<void, MailError>;
}
export class Mail extends Context.Service<Mail, MailService>()("bae/Mail") {}

/** Every place Better Auth asks you to deliver something to a human. */
export type Touchpoint =
  | "reset-password"
  | "verify-email"
  | "magic-link"
  | "email-otp"
  | "change-email"
  | "delete-account"
  | "organization-invitation"
  | "two-factor-otp"
  | "phone-otp";

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}
export interface EmailTemplatesService {
  readonly render: (input: {
    readonly touchpoint: Touchpoint;
    readonly variables: Readonly<Record<string, string>>;
  }) => Effect.Effect<RenderedMail>;
}
export class EmailTemplates extends Context.Service<EmailTemplates, EmailTemplatesService>()(
  "bae/EmailTemplates",
) {}

// ── 4. Sms ────────────────────────────────────────────────────────────────────

export interface SmsService {
  readonly send: (to: string, body: string) => Effect.Effect<void, MailError>;
}
export class Sms extends Context.Service<Sms, SmsService>()("bae/Sms") {}

// ── 5. SecondaryStore — feeds `secondaryStorage` ────────────────────────────

export interface SecondaryStoreService {
  readonly get: (key: string) => Effect.Effect<string | null>;
  readonly set: (key: string, value: string, ttlSeconds?: number) => Effect.Effect<void>;
  readonly delete: (key: string) => Effect.Effect<void>;
  readonly getAndDelete?: (key: string) => Effect.Effect<string | null>;
  readonly increment?: (key: string, ttlSeconds: number) => Effect.Effect<number>;
}
export class SecondaryStore extends Context.Service<SecondaryStore, SecondaryStoreService>()(
  "bae/SecondaryStore",
) {}

// ── 6. RateLimitStorage — feeds `rateLimit.customStorage` ───────────────────

export interface RateLimitRow {
  readonly key: string;
  readonly count: number;
  readonly lastRequest: number;
}
export interface RateLimitStorageService {
  readonly get: (key: string) => Effect.Effect<RateLimitRow | null>;
  readonly set: (key: string, value: RateLimitRow, update?: boolean) => Effect.Effect<void>;
  /** Atomic path. Absent means Better Auth takes its documented non-atomic fallback. */
  readonly consume?: (
    key: string,
    rule: { readonly window: number; readonly max: number },
  ) => Effect.Effect<{ readonly allowed: boolean; readonly retryAfter: number | null }>;
}
export class RateLimitStorage extends Context.Service<RateLimitStorage, RateLimitStorageService>()(
  "bae/RateLimitStorage",
) {}

// ── 7. Captcha — needs a credential ────────────────────────────────────────

export interface CaptchaService {
  /**
   * Matches Better Auth's own `Providers` constant exactly. `captchafox` was
   * missing until an audit compared the two; a consumer using it could not
   * express it, and nothing caught that because nothing wired this tag into a
   * configuration.
   */
  readonly provider: "cloudflare-turnstile" | "google-recaptcha" | "hcaptcha" | "captchafox";
  readonly secretKey: string;
  /**
   * Which routes to protect. Better Auth defaults to `/sign-up/email`,
   * `/sign-in/email` and `/request-password-reset` — so a deployment with a
   * magic-link or OTP flow is unprotected unless it says so here.
   */
  readonly endpoints?: ReadonlyArray<string>;
}
export class Captcha extends Context.Service<Captcha, CaptchaService>()("bae/Captcha") {}

// ── The whole contract ────────────────────────────────────────────────────────

/** Everything a full Better Auth configuration can require. */
export type Capabilities =
  | Database
  | Mail
  | EmailTemplates
  | Sms
  | SecondaryStore
  | RateLimitStorage
  | Captcha;
