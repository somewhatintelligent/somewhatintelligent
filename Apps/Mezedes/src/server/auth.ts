import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

export interface AuthEnv {
  readonly POLICY_AUD?: string | undefined;
  readonly TEAM_DOMAIN?: string | undefined;
}

export type Denial =
  | "unconfigured"
  | "no-token"
  | "no-identity"
  | "malformed"
  | "unsupported-alg"
  | "alg-mismatch"
  | "jwks-unavailable"
  | "unknown-key"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-audience"
  | "wrong-issuer";

export interface Principal {
  readonly sub: string;
  /**
   * The claim the tenant key derives from, so it is required rather than
   * optional: a token that cannot be attributed to an owner is refused, never
   * defaulted onto someone else's index. An IdP login always carries it;
   * an Access SERVICE token does not — it is a machine identity with
   * `common_name` and no user behind it, and so has no tenant of its own.
   */
  readonly email: string;
}

/**
 * The tenant key: sha-256 of the verified identity, first 16 hex chars (§5.1).
 *
 * Derived per request from the token rather than fixed at deploy time. The
 * Access policy is the only thing that decides who gets in, and whoever that
 * is owns their own index and blob prefix — so widening the policy to a second
 * person gives them their own tenant rather than a share of the first's.
 */
export const ownerKey = async (identity: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
};

export type AuthResult =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly denial: Denial; readonly detail: string };

export interface AuthDeps {
  readonly fetch?: (url: string) => Promise<Response>;
  readonly now?: () => number;
}

const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

const CLOCK_SKEW_S = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_ROTATION_COOLDOWN_MS = 10 * 1000;
const ALGORITHMS = ["RS256", "ES256"];

const deny = (denial: Denial, detail: string): AuthResult => ({ ok: false, denial, detail });

export const authorize = async (
  request: Request,
  env: AuthEnv,
  deps: AuthDeps = {},
): Promise<AuthResult> => {
  const config = resolveConfig(env);
  if (!config) {
    return deny(
      "unconfigured",
      "POLICY_AUD and TEAM_DOMAIN must both be set. POLICY_AUD is the Access application's `aud`; TEAM_DOMAIN is the https origin of the Zero Trust team.",
    );
  }

  const token = request.headers.get(ACCESS_HEADER);
  if (!token) {
    return deny("no-token", `No ${ACCESS_HEADER} header. Access did not front this request.`);
  }

  // Checked before anything is fetched: a token whose alg we would never accept
  // must not cost a JWKS subrequest.
  let header: { kid?: string; alg?: string };
  try {
    header = decodeProtectedHeader(token);
  } catch (cause) {
    return deny("malformed", cause instanceof Error ? cause.message : String(cause));
  }
  if (!ALGORITHMS.includes(header.alg ?? "")) {
    return deny("unsupported-alg", `Rejected alg ${JSON.stringify(header.alg)}.`);
  }

  // `fetch` is wrapped rather than passed by reference: it is a global that
  // must be called with `globalThis` as its receiver, and detaching it throws
  // on stricter compatibility dates.
  const resolved = {
    fetch: deps.fetch ?? ((url: string) => fetch(url)),
    now: deps.now ?? Date.now,
  };

  const first = await verifyAgainst(token, config, resolved, false);
  // An unknown kid is the rotation signal: refetch once, ahead of the TTL but
  // no more than once per cooldown, so bogus kids cannot become a request storm.
  return first.ok || first.denial !== "unknown-key"
    ? first
    : verifyAgainst(token, config, resolved, true);
};

interface Config {
  readonly teamOrigin: string;
  readonly aud: string;
}
interface Resolved {
  readonly fetch: (url: string) => Promise<Response>;
  readonly now: () => number;
}

const resolveConfig = (env: AuthEnv): Config | null => {
  const aud = env.POLICY_AUD?.trim();
  const team = env.TEAM_DOMAIN?.trim();
  if (!aud || !team) return null;
  try {
    const url = new URL(team.includes("://") ? team : `https://${team}`);
    return url.protocol === "https:" ? { teamOrigin: url.origin, aud } : null;
  } catch {
    return null;
  }
};

const verifyAgainst = async (
  token: string,
  config: Config,
  deps: Resolved,
  rotated: boolean,
): Promise<AuthResult> => {
  const jwks = await keysFor(config.teamOrigin, deps, rotated);
  if (jwks.keys.length === 0) {
    return deny(
      "jwks-unavailable",
      `No signing keys from ${config.teamOrigin}/cdn-cgi/access/certs — ${lastFailure.get(config.teamOrigin) ?? "no attempt recorded"}.`,
    );
  }

  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: config.teamOrigin,
      audience: config.aud,
      algorithms: ALGORITHMS,
      clockTolerance: CLOCK_SKEW_S,
      currentDate: new Date(deps.now()),
    });
    return accepted(payload, deps.now());
  } catch (cause) {
    return denialFor(cause, token, jwks);
  }
};

/** jose only checks `iat` under maxTokenAge, and a token issued in the future
 *  is a clock or minting fault worth refusing on its own. */
const accepted = (payload: JWTPayload, atMs: number): AuthResult => {
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  if (iat !== null && Math.floor(atMs / 1000) + CLOCK_SKEW_S < iat) {
    return deny(
      "not-yet-valid",
      `Token was issued in the future, at ${new Date(iat * 1000).toISOString()}.`,
    );
  }
  const email = typeof payload["email"] === "string" ? payload["email"] : "";
  if (email === "") {
    return deny(
      "no-identity",
      "The token carries no `email` claim, so the request cannot be attributed to an owner. Access service tokens are machine identities and have none — authenticate as a user instead.",
    );
  }

  return {
    ok: true,
    principal: { sub: typeof payload.sub === "string" ? payload.sub : "", email },
  };
};

const denialFor = (cause: unknown, token: string, jwks: JSONWebKeySet): AuthResult => {
  const { code, message } = cause as { code?: string; message?: string };
  const detail = message ?? String(cause);
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return deny("expired", detail);
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return deny("bad-signature", "Signature does not verify against any published Access key.");
    case "ERR_JOSE_ALG_NOT_ALLOWED":
      return deny("unsupported-alg", detail);
    case "ERR_JWKS_NO_MATCHING_KEY":
      return (
        algMismatch(token, jwks) ??
        deny("unknown-key", "No published Access key matches the token's kid.")
      );
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      switch ((cause as { claim?: string }).claim) {
        case "iss":
          return deny("wrong-issuer", detail);
        case "aud":
          return deny("wrong-audience", detail);
        case "nbf":
        case "iat":
          return deny("not-yet-valid", detail);
        default:
          return deny("malformed", detail);
      }
    default:
      return deny("malformed", detail);
  }
};

/** A kid that resolves to no key is usually rotation, but it is also what
 *  algorithm confusion looks like. One lookup separates "retry" from "probe". */
const algMismatch = (token: string, jwks: JSONWebKeySet): AuthResult | null => {
  let header: { kid?: string; alg?: string };
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return null;
  }
  const key = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!key?.alg || key.alg === header.alg) return null;
  return deny("alg-mismatch", `Token claims ${header.alg} but key ${header.kid} is ${key.alg}.`);
};

interface JwksCache {
  jwks: JSONWebKeySet;
  fetchedAt: number;
  inflight: Promise<JSONWebKeySet> | null;
}

/** Not `caches` — that name is the Cache API global. */
const jwksCaches = new Map<string, JwksCache>();
const lastFailure = new Map<string, string>();

const keysFor = async (
  teamOrigin: string,
  deps: Resolved,
  rotated: boolean,
): Promise<JSONWebKeySet> => {
  let cache = jwksCaches.get(teamOrigin);
  if (!cache) {
    cache = { jwks: { keys: [] }, fetchedAt: 0, inflight: null };
    jwksCaches.set(teamOrigin, cache);
  }

  const age = deps.now() - cache.fetchedAt;
  if (cache.fetchedAt !== 0 && age < (rotated ? JWKS_ROTATION_COOLDOWN_MS : JWKS_TTL_MS))
    return cache.jwks;
  if (cache.inflight) return cache.inflight;

  const settled = cache;
  const run = (async () => {
    try {
      const fetched = await fetchKeys(teamOrigin, deps);
      // A failed refresh keeps the previous keys rather than locking everyone out.
      if (fetched) {
        settled.jwks = fetched;
        settled.fetchedAt = deps.now();
      }
      return settled.jwks;
    } finally {
      settled.inflight = null;
    }
  })();
  cache.inflight = run;
  return run;
};

/** null means "the fetch failed". A throw, a non-200 and a malformed body are
 *  three different faults that would otherwise arrive as one word. */
const fetchKeys = async (teamOrigin: string, deps: Resolved): Promise<JSONWebKeySet | null> => {
  const url = `${teamOrigin}/cdn-cgi/access/certs`;
  let body: unknown;
  try {
    const response = await deps.fetch(url);
    if (!response.ok) {
      lastFailure.set(teamOrigin, `the certs endpoint answered HTTP ${response.status}`);
      return null;
    }
    body = await response.json();
  } catch (cause) {
    lastFailure.set(
      teamOrigin,
      `fetching it threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }

  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) {
    lastFailure.set(teamOrigin, "the response carried no `keys` array");
    return null;
  }
  lastFailure.delete(teamOrigin);
  return { keys } as JSONWebKeySet;
};
