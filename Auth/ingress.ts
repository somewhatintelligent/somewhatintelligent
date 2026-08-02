export const ACCOUNT_SUBDOMAIN = "apostoli-geyer";

export const PRODUCTION_ZONE = "somewhatintelligent.ca";

export const PRODUCTION_STAGE = "prod";

export const AUTH_SUBDOMAIN = "accounts";

export const AUTH_BASE_PATH = "/api/auth";

export const DEV_PORT = 1350;

export const AVATAR_PREFIX = "/avatars/";

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"] as const;

export type AvatarContentType = (typeof ALLOWED_AVATAR_TYPES)[number];

export const workerSafeStage = (stage: string): string =>
  stage
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export interface Ingress {
  readonly name: string;
  /**
   * The hostname this stage CLAIMS, or `null` to answer on workers.dev alone.
   *
   * Only production claims one. Attaching a custom domain per stage would have
   * every stage contending for records on the zone, and a stage name carrying
   * an underscore — `dev_stoli` — is not a label DNS will take.
   */
  readonly hostname: string | null;
  readonly origin: string;
  /**
   * The `Domain` every session cookie is scoped to, or `null` for host-only.
   *
   * Only production has one. Every other stage answers on `*.workers.dev`,
   * which is on the Public Suffix List — a browser rejects a cookie scoped to
   * it outright — so a sibling app on its own workers.dev host cannot see this
   * session no matter what is set here. Non-production apps resolve identity
   * through the auth server itself rather than through a shared cookie.
   */
  readonly cookieDomain: string | null;
}

export const ingress = (stage: string, local: boolean): Ingress => {
  const name = `si-identity-${workerSafeStage(stage)}`;
  const production = stage === PRODUCTION_STAGE;
  const hostname = production ? `${AUTH_SUBDOMAIN}.${PRODUCTION_ZONE}` : null;
  const origin = local
    ? `http://localhost:${DEV_PORT}`
    : hostname === null
      ? `https://${name}.${ACCOUNT_SUBDOMAIN}.workers.dev`
      : `https://${hostname}`;

  return {
    name,
    hostname: local ? null : hostname,
    origin,
    cookieDomain: production ? `.${PRODUCTION_ZONE}` : null,
  };
};
