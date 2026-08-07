import { PRODUCTION_STAGE, PRODUCTION_ZONE, workerSafeStage } from "platform.names";

const ACCOUNT_SUBDOMAIN = "apostoli-geyer";

const AUTH_SUBDOMAIN = "accounts";

export const AUTH_BASE_PATH = "/api/auth";

/**
 * The metadata URL RFC 8414 puts at the ORIGIN ROOT.
 *
 * An issuer with a path has TWO discovery URLs and they are built by different
 * rules. OpenID Connect Discovery appends — `{issuer}/.well-known/…` — and
 * lands under the base path, where routing already carried it. RFC 8414 §3.1
 * INSERTS `/.well-known/oauth-authorization-server` between the host and the
 * issuer's path instead, which lands outside it. Both name the same document;
 * clients differ on which they ask for, and MCP clients ask for this one.
 *
 * The plugin answers it — it registers both aliases — so the only thing that
 * was ever missing is a route. Derived from {@link AUTH_BASE_PATH} rather than
 * written out, because the two cannot be allowed to drift: a changed base path
 * with a stale literal here is a 404 that nothing in the app would notice.
 */
export const OAUTH_METADATA_PATH = `/.well-known/oauth-authorization-server${AUTH_BASE_PATH}`;

/**
 * Whether `app/worker.ts` hands this request to the auth Worker.
 *
 * A bare `startsWith(AUTH_BASE_PATH)` is not this predicate: it also claims
 * `/api/authenticate`, turning some other route's 404 into Better Auth's. The
 * base path is matched exactly or as a path SEGMENT prefix, and the one URL
 * that lives outside it is named rather than approximated — no blanket
 * `/.well-known/` forward, since the origin serves the app too and those are
 * its paths to answer.
 */
export const servedByAuth = (pathname: string): boolean =>
  pathname === AUTH_BASE_PATH ||
  pathname.startsWith(`${AUTH_BASE_PATH}/`) ||
  pathname === OAUTH_METADATA_PATH;

export const DEV_PORT = 1350;

export const AVATAR_PREFIX = "/avatars/";

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"] as const;

export type AvatarContentType = (typeof ALLOWED_AVATAR_TYPES)[number];

export interface Ingress {
  readonly name: string;
  /**
   * The hostname this stage CLAIMS, or `null` to answer on workers.dev alone.
   *
   * Production only: a custom domain per stage would have every stage
   * contending for records on the zone, and `dev_stoli` is not a label DNS
   * will take anyway.
   */
  readonly hostname: string | null;
  readonly origin: string;
  /**
   * The `Domain` every session cookie is scoped to, or `null` for host-only.
   *
   * Production only, and `null` elsewhere is not a gap: `*.workers.dev` is on
   * the Public Suffix List, so a browser rejects a cookie scoped to it outright
   * and no setting here would make a sibling app see this session.
   */
  readonly cookieDomain: string | null;
}

/** The name the live worker already carries, frozen from when the stage was `prod`. */
export const PRODUCTION_WORKER_NAME = "si-identity-prod";

export const ingress = (stage: string, local: boolean): Ingress => {
  const production = stage === PRODUCTION_STAGE;
  const name = production ? PRODUCTION_WORKER_NAME : `si-identity-${workerSafeStage(stage)}`;
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
