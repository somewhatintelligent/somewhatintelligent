import { PRODUCTION_STAGE, PRODUCTION_ZONE, workerSafeStage } from "platform.names";

const ACCOUNT_SUBDOMAIN = "apostoli-geyer";

const AUTH_SUBDOMAIN = "accounts";

export const AUTH_BASE_PATH = "/api/auth";

export const DEV_PORT = 1350;

export const AVATAR_PREFIX = "/avatars/";

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"] as const;

export type AvatarContentType = (typeof ALLOWED_AVATAR_TYPES)[number];

/** The two documents a client reads to learn this is an OAuth server at all. */
const DISCOVERY_DOCUMENTS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

/**
 * Where a client is entitled to look for a discovery document, resolved to the
 * one path Better Auth answers on.
 *
 * The issuer is `<origin>${AUTH_BASE_PATH}`, so the plugin serves both
 * documents under that path — and a client that has only ever been handed the
 * issuer looks at the ROOT of the origin first. RFC 8414 §3.1 inserts the
 * issuer's path AFTER the well-known segment; OpenID Discovery appends the
 * segment to the issuer; MCP clients try the suffix-less form too, because most
 * issuers have no path at all. All of them mean the same document, and a server
 * that answers some of them is one a client discovers or does not depending on
 * which it tried first.
 *
 * `null` for anything else. `app/worker.ts` is what acts on the answer — the
 * canonical form already reaches the auth worker on the `AUTH_BASE_PATH`
 * prefix, and is matched here anyway so this function answers the whole
 * question rather than the half that needed rewriting.
 */
export const oauthMetadataTarget = (pathname: string): string | null => {
  for (const document of DISCOVERY_DOCUMENTS) {
    const canonical = `${AUTH_BASE_PATH}${document}`;
    if (pathname === canonical || pathname === document) return canonical;
    if (pathname === `${document}${AUTH_BASE_PATH}`) return canonical;
  }
  return null;
};

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
