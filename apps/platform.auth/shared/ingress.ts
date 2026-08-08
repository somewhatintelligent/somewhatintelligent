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
 * Derived from {@link AUTH_BASE_PATH} rather than written out, because the two
 * cannot be allowed to drift: a changed base path with a stale literal here is
 * a 404 that nothing in the app would notice.
 *
 * Named on its own because `integ/oauth-provider.integ.test.ts` asks for it
 * over HTTP by this exact string. {@link oauthMetadataTarget} is what routes
 * it, along with the three other spellings that mean the same document.
 */
export const OAUTH_METADATA_PATH = `/.well-known/oauth-authorization-server${AUTH_BASE_PATH}`;

/**
 * Whether `app/worker.ts` hands this request to the auth Worker unchanged.
 *
 * A bare `startsWith(AUTH_BASE_PATH)` is not this predicate: it also claims
 * `/api/authenticate`, turning some other route's 404 into Better Auth's. The
 * base path is matched exactly or as a path SEGMENT prefix.
 *
 * The discovery documents that live OUTSIDE the base path are deliberately not
 * here — they need their path rewritten, not merely forwarded, so they are
 * {@link oauthMetadataTarget}'s. One rule each: this one decides whose request
 * it is, that one decides what the request should say.
 */
export const servedByAuth = (pathname: string): boolean =>
  pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`);

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
 * `null` for anything else — and pointedly for `/.well-known/security.txt` and
 * its neighbours, which are the APP's to answer. No blanket `/.well-known/`
 * forward: this origin serves a site as well as an auth server.
 *
 * `app/worker.ts` is what acts on the answer. The canonical form already
 * reaches the auth worker through {@link servedByAuth}, and is matched here
 * anyway so this function answers the whole question rather than the half that
 * needed rewriting.
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
