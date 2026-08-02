/**
 * What a deployment has switched on, read off the configuration it runs.
 *
 * Ids, not affordances: everything here is a Better Auth id — a social provider
 * key, a plugin's own `id`. Mapping an id to a screen or an icon belongs to the
 * app, and keeping it there is what lets a plugin this package has never heard
 * of still reach the UI.
 *
 * A field is here only if it can be READ off the options. Plugin objects expose
 * endpoints, schema and hooks, never the options they were constructed with, so
 * a captcha site key or the organization plugin's membership config cannot
 * appear here — and is not restated in its place.
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
  /** The configured social provider keys — one button per entry. */
  readonly socialProviders: ReadonlyArray<string>;
  /**
   * Every plugin id the deployment runs, in configuration order. An id this
   * package has never heard of is reported unchanged rather than dropped.
   */
  readonly plugins: ReadonlyArray<string>;
}

/**
 * The plugin array is `[] | BetterAuthPlugin[]`, and the empty-tuple branch
 * loses the element type. Narrowing here keeps the assertion in one place.
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
 * Pure and synchronous — no I/O, no Better Auth instance — which is what lets
 * the same function run at build time and inside a request handler.
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
