/**
 * THE OAUTH SURFACE, against the deployed stack.
 *
 * Runs under workerd by default — both Workers, the D1, the migrations —
 * rather than in the account; see `DEV` below. That is not a lesser version of
 * the test: the finding this file exists for is a ROUTING one, and routing is
 * exactly what an in-process handler cannot show you.
 *
 * `app/worker.ts` is the only ingress. It forwards what it recognises to the
 * `AUTH` binding and hands everything else to the TanStack app, and RFC 8414
 * puts one of the metadata URLs for an issuer WITH a path at the ORIGIN ROOT —
 * `/.well-known/oauth-authorization-server/api/auth` — which does not live
 * under the base path and so was not forwarded. The plugin answered it; nothing
 * ever asked it to. Better Auth says so itself at boot:
 *
 *     Please ensure '/.well-known/oauth-authorization-server/api/auth' exists.
 *
 * A test that called `auth.handler` directly would have passed against that
 * bug, because the handler was never the broken half.
 *
 * Keep the stack up between runs with NO_DESTROY=1.
 */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
/**
 * The NARROW path, matching `alchemy.run.ts`. `alchemy/Drizzle`'s barrel
 * re-exports `Drizzle/MySQL.ts`, which imports `@effect/sql-mysql2` eagerly —
 * an optional peer this repo does not install — so the barrel cannot be
 * imported at all and takes the whole suite down at collection time.
 */
import * as Drizzle from "alchemy/Drizzle/Providers";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import Stack from "../alchemy.run.ts";
import { AUTH_BASE_PATH, OAUTH_METADATA_PATH } from "../shared/ingress.ts";

/**
 * FROM THE ENVIRONMENT, not a literal, and the stack reads the same variable.
 *
 * `Test.make({ dev })` configures the ENGINE, but `alchemy.run.ts` decides the
 * origin from `Alchemy.ALCHEMY_DEV` — so a hardcoded `dev: true` runs the
 * Workers under workerd while `ingress()` still reports the workers.dev
 * hostname, and every request in this file dies on ECONNRESET against a URL
 * nothing is listening on. One variable, read by both halves. `ALCHEMY_DEV=0`
 * runs the same suite against a real deploy.
 */
const DEV = process.env["ALCHEMY_DEV"] !== "0";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  state: Alchemy.localState(),
  /** `test_<name>` — `infra/StandardizedStage.ts` rejects anything else. */
  stage: "test_oauth",
  dev: DEV,
});

const HOOK_TIMEOUT = 600_000;
const TEST_TIMEOUT = 120_000;

const stack = beforeAll(deploy(Stack), { timeout: HOOK_TIMEOUT });
afterAll.skipIf(!!process.env["NO_DESTROY"])(destroy(Stack), { timeout: HOOK_TIMEOUT });

/** Alchemy reports the dev URL with a trailing slash and a deploy without one. */
const at = (base: string, path: string): string => `${base.replace(/\/+$/, "")}${path}`;

const SIGN_UP = `${AUTH_BASE_PATH}/sign-up/email`;
const REGISTER = `${AUTH_BASE_PATH}/oauth2/register`;
const DISCOVERY = `${AUTH_BASE_PATH}/.well-known/openid-configuration`;

/**
 * `executeWhenReady` for everything, INCLUDING the 401 assertion: it retries
 * only the cold-start statuses (404 / 5xx) and hands every other status back
 * for the caller to assert on. Nothing below expects a 404, so there is no
 * assertion here that its retry could swallow.
 */
const json = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const response = yield* Test.executeWhenReady(request);
    // `response.json`, not a hand-rolled parse: an edge HTML error page then
    // arrives as a typed failure rather than a `SyntaxError` defect.
    return { status: response.status, body: (yield* response.json) as Record<string, any> };
  });

const get = (url: string) => json(HttpClientRequest.get(url));

const post = (url: string, body: unknown, token?: string) =>
  json(
    HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      token === undefined ? (request) => request : HttpClientRequest.bearerToken(token),
    ),
  );

/**
 * A session token, via the `bearer` plugin rather than a cookie jar. The
 * plugin is in the configuration either way, and a bearer token is one header
 * instead of a `set-cookie` fold the HTTP client is not obliged to preserve.
 */
const signUp = (origin: string, email: string) =>
  Effect.gen(function* () {
    const { body } = yield* post(at(origin, SIGN_UP), {
      email,
      password: "correct-horse-battery-staple",
      name: "Registrar",
    });
    // `expect` prints the body it was given, so a failed sign-up reports itself.
    expect(body["token"]).toEqual(expect.any(String));
    return body["token"] as string;
  });

/** RFC 7591's one required field, plus enough to be a usable client. */
const registration = {
  redirect_uris: ["https://client.example.com/callback"],
  client_name: "Integ Client",
};

// ── Discovery ───────────────────────────────────────────────────────────────

test(
  "every metadata alias the specs name is routed to the auth worker",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const issuer = at(origin, AUTH_BASE_PATH);

    /**
     * OpenID Connect Discovery APPENDS to an issuer with a path; RFC 8414 also
     * INSERTS at the origin root; and a client holding only an origin asks for
     * the bare root form, because most issuers have no path at all. Clients
     * differ on which they try, so every spelling has to answer — and the ones
     * outside the base path are what `app/worker.ts` dropped.
     *
     * Concurrently: unrelated GETs of the same static document. Against a real
     * deploy (`ALCHEMY_DEV=0`) they then ride out ONE cold-start window between
     * them rather than one each in series.
     */
    yield* Effect.forEach(
      [
        DISCOVERY,
        `${AUTH_BASE_PATH}/.well-known/oauth-authorization-server`,
        OAUTH_METADATA_PATH,
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
        `/.well-known/openid-configuration${AUTH_BASE_PATH}`,
      ],
      (path) =>
        Effect.map(get(at(origin, path)), ({ status, body }) => {
          expect({ path, status }).toEqual({ path, status: 200 });
          expect(body["issuer"]).toBe(issuer);
        }),
      { concurrency: "unbounded" },
    );
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "the metadata advertises what the server can actually do",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const issuer = at(origin, AUTH_BASE_PATH);
    const { body } = yield* get(at(origin, DISCOVERY));

    // Absent entirely unless `allowDynamicClientRegistration` is set.
    expect(body["registration_endpoint"]).toBe(`${issuer}/oauth2/register`);

    /**
     * THE STANDARD CLAIMS AND THE CUSTOM ONE, because advertising the custom
     * one is what nearly deleted the rest: `advertisedMetadata.claims_supported`
     * REPLACES the derived list, and an assertion that only looked for `role`
     * passed while discovery went from fourteen claims to one.
     *
     * `test/oauth-provider.test.ts` pins the same thing against the resolved
     * options, so the cheap suite catches it first; this is the end-to-end
     * confirmation.
     */
    expect(body["claims_supported"]).toEqual(
      expect.arrayContaining(["sub", "iss", "aud", "exp", "email", "name", "role"]),
    );

    /** Including the mezes scopes: a client cannot ask for what it never saw. */
    expect(body["scopes_supported"]).toEqual(
      expect.arrayContaining([
        "openid",
        "profile",
        "email",
        "offline_access",
        "mezes:read",
        "mezes:write",
      ]),
    );

    /**
     * No `client_credentials`. It is the one grant that issues a token with no
     * user and no consent screen, and nothing here should be advertising it.
     */
    expect(body["grant_types_supported"]).toEqual(["authorization_code", "refresh_token"]);

    /**
     * PKCE is why a public client is not a code-interception problem. If this
     * stops being advertised, that argument has quietly stopped holding.
     */
    expect(body["code_challenge_methods_supported"]).toContain("S256");
  }),
  { timeout: TEST_TIMEOUT },
);

// ── Registration ────────────────────────────────────────────────────────────

test(
  "a signed-in user can register a client",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const token = yield* signUp(origin, "registrar@example.test");

    const { status, body } = yield* post(at(origin, REGISTER), registration, token);

    expect(status).toBeLessThan(300);
    expect(body["client_id"]).toEqual(expect.any(String));
    expect(body["redirect_uris"]).toEqual(registration.redirect_uris);
  }),
  { timeout: TEST_TIMEOUT },
);

/**
 * THE POSTURE, and the two assertions that decide it.
 *
 * This suite previously asserted a 401 here, on the argument that an anonymous
 * registrant chooses its own `client_name` and the consent screen shows that
 * name and nothing else. The argument was right; the fix was the screen rather
 * than the endpoint. `_auth/consent.tsx` now leads with a warning whenever
 * nobody has vouched for a client, which is what this second assertion is
 * about — a 200 here is only defensible while `selfRegistered` is true and
 * visible.
 *
 * See the `allowUnauthenticatedClientRegistration` note in `api/config.ts`.
 */
test(
  "an anonymous caller can register, and is marked as having vouched for itself",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const { status, body } = yield* post(at(origin, REGISTER), registration);

    expect(status).toBeLessThan(300);
    expect(body["client_id"]).toEqual(expect.any(String));

    /**
     * Public, because upstream forces it: no secret was issued despite the
     * default `token_endpoint_auth_method`, which is what makes PKCE mandatory
     * for this client.
     */
    expect(body["token_endpoint_auth_method"]).toBe("none");
    expect(body["client_secret"]).toBeUndefined();

    /** Nobody signed in registered it — the fact the consent warning is drawn from. */
    expect(body["user_id"]).toBeUndefined();
  }),
  { timeout: TEST_TIMEOUT },
);

/**
 * The other half of that posture: an anonymous registrant may not ask for the
 * grant that skips the person entirely. Upstream refuses it without a session,
 * and `grantTypes` refuses it for everyone — either alone is enough, and both
 * are asserted because this is the assertion someone will reach for when
 * loosening one of them.
 */
test(
  "an anonymous caller cannot register for client_credentials",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const { status } = yield* post(at(origin, REGISTER), {
      ...registration,
      grant_types: ["client_credentials"],
    });

    expect(status).toBe(400);
  }),
  { timeout: TEST_TIMEOUT },
);

/**
 * `skip_consent` is `z.never()` on this endpoint upstream. Asserted because it
 * is load-bearing for the posture above: a client that could set it at
 * registration would bypass the only screen a user ever sees.
 */
test(
  "a registered client cannot register itself past the consent screen",
  Effect.gen(function* () {
    const { origin } = yield* stack;
    const token = yield* signUp(origin, "sneaky@example.test");

    const { status } = yield* post(
      at(origin, REGISTER),
      { ...registration, skip_consent: true },
      token,
    );

    expect(status).toBe(400);
  }),
  { timeout: TEST_TIMEOUT },
);
