/**
 * What a deployment has switched on, read off the configuration it runs.
 *
 * A single-page app cannot ask a type which sign-in buttons to render. Knowing
 * that `signIn.social({ provider: "apple" })` compiles is not the same as
 * having `["apple", "google"]` to iterate, and types erase before the render.
 * So the app needs a VALUE, and this derives it from the one place the answer
 * already exists.
 *
 * ## Ids, not affordances
 *
 * Everything here is a Better Auth id — a social provider key, a plugin's own
 * `id`. Nothing maps an id to a screen, a section or an icon, and nothing
 * carries a closed list of blessed features. That mapping belongs to the app
 * that renders it, and keeping it there is what lets a plugin nobody here has
 * heard of still show up.
 *
 * The rule the shape follows: a field is here because it can be READ off the
 * options, or it is not here. Anything a plugin keeps to itself is unreadable —
 * plugin objects expose endpoints, schema and hooks, never the options they were
 * constructed with — so a captcha SITE key or an organization plugin's
 * membership config cannot appear, and is not restated in its place. A
 * restatement is the thing that drifts.
 */

import type { BetterAuthOptions } from "better-auth";

/** Better Auth's own default when a configuration does not set one. */
export const DEFAULT_BASE_PATH = "/api/auth";

export interface AuthFeatures {
  /**
   * Where the auth API is mounted, so a client built elsewhere can reach it.
   * Always begins with `/`.
   */
  readonly basePath: string;
  /** Whether the core email-and-password flow is on. */
  readonly emailAndPassword: boolean;
  /**
   * The configured social provider keys, e.g. `["apple", "google"]`.
   *
   * One button per entry is the whole reason this is an array and not a type.
   */
  readonly socialProviders: ReadonlyArray<string>;
  /**
   * Every plugin id the deployment runs, in configuration order.
   *
   * `passkey`, `two-factor`, `organization` and the rest gate their sections
   * by presence here. An id this package has never heard of is reported
   * unchanged rather than dropped.
   */
  readonly plugins: ReadonlyArray<string>;
}

/**
 * `BetterAuthPlugin["id"]` is declared `string`, so the read is typed — but the
 * array itself is `[] | BetterAuthPlugin[]`, and an empty-tuple branch loses the
 * element type. Narrowing here keeps the assertion in one line instead of at
 * every call site.
 */
const pluginIds = (options: BetterAuthOptions): ReadonlyArray<string> =>
  ((options.plugins ?? []) as ReadonlyArray<{ readonly id: string }>).map((plugin) => plugin.id);

const normalisePath = (basePath: string | undefined): string => {
  if (basePath === undefined || basePath.length === 0) return DEFAULT_BASE_PATH;
  return basePath.startsWith("/") ? basePath : `/${basePath}`;
};

/**
 * Derive the feature set from a resolved configuration.
 *
 * Pure and synchronous: no I/O, no Better Auth instance, nothing to await. That
 * is what lets the same function run at build time — where the app imports the
 * result as a constant and a missing feature is a compile error — and inside a
 * request handler, where it answers a deployment the app could not import.
 */
export const deriveFeatures = (options: BetterAuthOptions): AuthFeatures => ({
  basePath: normalisePath(options.basePath),
  emailAndPassword: options.emailAndPassword?.enabled === true,
  socialProviders: Object.keys(options.socialProviders ?? {}),
  plugins: pluginIds(options),
});

/** Whether a plugin is running, by its Better Auth id. */
export const hasPlugin = (features: AuthFeatures, id: string): boolean =>
  features.plugins.includes(id);

/** Whether a social provider is configured, by its Better Auth key. */
export const hasSocialProvider = (features: AuthFeatures, id: string): boolean =>
  features.socialProviders.includes(id);
