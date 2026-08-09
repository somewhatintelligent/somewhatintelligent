import {
  PREVIEW_SCRIPTS,
  PRODUCTION_STAGE,
  PRODUCTION_ZONE,
  workerSafeStage,
  workersDevHost,
} from "platform.names";

const AUTH_SUBDOMAIN = "accounts";

export const AUTH_BASE_PATH = "/api/auth";

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
  const name = production ? PRODUCTION_WORKER_NAME : PREVIEW_SCRIPTS.auth(workerSafeStage(stage));
  const hostname = production ? `${AUTH_SUBDOMAIN}.${PRODUCTION_ZONE}` : null;
  const origin = local
    ? `http://localhost:${DEV_PORT}`
    : hostname === null
      ? `https://${workersDevHost(name)}`
      : `https://${hostname}`;

  return {
    name,
    hostname: local ? null : hostname,
    origin,
    cookieDomain: production ? `.${PRODUCTION_ZONE}` : null,
  };
};
