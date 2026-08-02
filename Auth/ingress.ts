export const ACCOUNT_SUBDOMAIN = "apostoli-geyer";

export const PRODUCTION_HOSTNAME = "somewhatintelligent.ca";

export const PRODUCTION_STAGE = "prod";

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
  readonly origin: string;
  readonly authBasePath: string;
  readonly authBaseURL: string;
}

export const ingress = (stage: string, local: boolean): Ingress => {
  const name = `si-identity-${workerSafeStage(stage)}`;
  const origin = local
    ? `http://localhost:${DEV_PORT}`
    : stage === PRODUCTION_STAGE
      ? `https://${PRODUCTION_HOSTNAME}`
      : `https://${name}.${ACCOUNT_SUBDOMAIN}.workers.dev`;

  return { name, origin, authBasePath: AUTH_BASE_PATH, authBaseURL: `${origin}${AUTH_BASE_PATH}` };
};
