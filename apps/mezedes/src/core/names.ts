const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 40;
/** A trailing `-v<n>` is the version selector, so a slug may not end in one. */
const VERSION_SUFFIX = /-v\d+$/;

export class InvalidName extends Error {
  override readonly name = "InvalidName";
  constructor(what: string, value: string, why: string) {
    super(`invalid ${what} ${JSON.stringify(value)}: ${why}`);
  }
}

export const isSlug = (value: string): boolean =>
  SLUG.test(value) && value.length <= MAX_SLUG && !VERSION_SUFFIX.test(value);

export const assertSlug = (value: string): string => {
  if (!isSlug(value)) {
    throw new InvalidName(
      "slug",
      value,
      `expected ${SLUG.source}, at most ${MAX_SLUG} chars, not ending in -v<n>`,
    );
  }
  return value;
};

export const slugify = (input: string): string => {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
  const cleaned = base === "" ? "mezes" : base;
  return VERSION_SUFFIX.test(cleaned) ? `${cleaned}-x` : cleaned;
};

export interface ArtifactRef {
  readonly slug: string;
  /** null means the live version. */
  readonly version: number | null;
}

/**
 * The ONE label under the artifact suffix, lowercased, or null. Both host
 * parsers start here, so "exactly one label" — the rule the wildcard
 * certificate and the wildcard route both depend on — is stated once, on a path
 * that runs before the auth gate.
 */
const hostLabel = (hostname: string, artifactSuffix: string): string | null => {
  const host = hostname.toLowerCase();
  if (!host.endsWith(`.${artifactSuffix}`)) return null;

  const label = host.slice(0, -(artifactSuffix.length + 1));
  return label === "" || label.includes(".") ? null : label;
};

/**
 * `signal-garden.a.example.com` → live; `signal-garden-v3.a.example.com` → v3.
 * Runs ahead of the auth gate, so it must never throw and never accept a host
 * it is unsure about.
 */
export const parseArtifactHost = (hostname: string, artifactSuffix: string): ArtifactRef | null => {
  const label = hostLabel(hostname, artifactSuffix);
  if (label === null) return null;

  const match = VERSION_SUFFIX.exec(label);
  if (match === null) return isSlug(label) ? { slug: label, version: null } : null;

  const slug = label.slice(0, match.index);
  const version = Number(match[0].slice(2));
  if (!isSlug(slug) || !Number.isSafeInteger(version) || version < 1) return null;
  return { slug, version };
};

/**
 * A preview host is `p--<token>.<artifactSuffix>` — one label, so the wildcard
 * certificate and route already cover it, and every path on it resolves the way
 * the mezes was built, relative or absolute, because the whole ORIGIN is the
 * capability rather than a prefix within one.
 *
 * `p--` cannot collide with a slug: `SLUG` allows single hyphens between
 * alphanumeric runs, so a doubled one never parses as a slug.
 */
const PREVIEW_PREFIX = "p--";
const TOKEN_BYTES = 16;
const TOKEN = new RegExp(`^[a-f0-9]{${String(TOKEN_BYTES * 2)}}$`);

/**
 * Minted HERE rather than where it is stored, because length and alphabet have
 * to satisfy `TOKEN` and nothing else enforces that agreement — a token shaped
 * elsewhere would simply fail to parse, and the preview would 404 a long way
 * from the edit that broke it.
 */
export const newPreviewToken = (): string =>
  [...crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const previewOrigin = (token: string, artifactSuffix: string): string =>
  `https://${PREVIEW_PREFIX}${token}.${artifactSuffix}`;

/** The token, or null for "not a preview host". Runs ahead of everything. */
export const parsePreviewHost = (hostname: string, artifactSuffix: string): string | null => {
  const label = hostLabel(hostname, artifactSuffix);
  if (label === null || !label.startsWith(PREVIEW_PREFIX)) return null;

  const token = label.slice(PREVIEW_PREFIX.length);
  return TOKEN.test(token) ? token : null;
};

/**
 * An index row plus where it serves. The index stores no hostname — that is a
 * property of the deploy, not of the row — so the URL is attached on the way
 * out, and BOTH surfaces that hand a record outward (`api.ts` for the shell,
 * `tools.ts` for MCP) go through here rather than deciding separately what
 * `url` means.
 */
export const located = <T extends { readonly slug: string }>(
  record: T,
  artifactSuffix: string,
): T & { readonly url: string } => ({ ...record, url: artifactUrl(record.slug, artifactSuffix) });

export const artifactUrl = (
  slug: string,
  artifactSuffix: string,
  version?: number | null,
): string => `https://${version == null ? slug : `${slug}-v${version}`}.${artifactSuffix}`;
