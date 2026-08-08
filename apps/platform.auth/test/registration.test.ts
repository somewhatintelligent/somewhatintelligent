/**
 * The first two things an MCP client does, done against the real server.
 *
 * It registers itself, then walks to the authorize endpoint. Neither step needs
 * an account, which is exactly why they are worth running: they are the part of
 * the flow that happens before anybody could have configured anything, and the
 * part that decides whether a coding agent reports "connected" or "this server
 * needs a client id".
 *
 * Where it stops is the consent screen — everything past it needs a signed-in
 * person, and `app/routes/_auth/consent.tsx` is where that lives.
 *
 * ONE INSTANCE PER GROUP, because `/oauth2/register` is limited to 5/60s and
 * that limit is real here (see the last group). A suite sharing one instance
 * would start failing on whichever test happened to be sixth.
 */

import { beforeAll, describe, expect, test } from "vite-plus/test";

import { authInstance } from "./auth-instance.ts";

const REDIRECT_URI = "http://127.0.0.1:5599/callback";

/** A `code_challenge` shape, not a real one — nothing here redeems a code. */
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const registerWith =
  (instance: ReturnType<typeof authInstance>) =>
  (body: Record<string, unknown> = {}): Promise<Response> =>
    instance.post("/api/auth/oauth2/register", {
      redirect_uris: [REDIRECT_URI],
      client_name: "a coding agent",
      ...body,
    });

describe("a client with no credentials registering itself", () => {
  const register = registerWith(authInstance());

  test("is issued a client id", async () => {
    const response = await register();

    expect(response.status).toBe(200);
    const client = (await response.json()) as Record<string, unknown>;
    expect(typeof client.client_id).toBe("string");
    expect(client.client_id).not.toBe("");
  });

  test("is made PUBLIC whatever it asked to be, so PKCE is not optional for it", async () => {
    // It asked for a secret. Unauthenticated registration overrides that: a
    // secret handed to an anonymous caller is a secret in no one's keeping.
    const response = await register({ token_endpoint_auth_method: "client_secret_basic" });
    const client = (await response.json()) as Record<string, unknown>;

    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret ?? "").toBe("");
  });

  test("may ask for the mezes scopes", async () => {
    const scope = "openid email offline_access mezes:read mezes:write";
    const response = await register({ scope });
    const client = (await response.json()) as { scope?: string };

    expect(response.status).toBe(200);
    for (const asked of scope.split(" ")) expect(client.scope?.split(" ")).toContain(asked);
  });
});

describe("what registration refuses", () => {
  const register = registerWith(authInstance());

  test("a grant that would issue a token with no person behind it", async () => {
    expect((await register({ grant_types: ["client_credentials"] })).status).toBe(400);
  });

  test("a scope this server does not issue", async () => {
    expect((await register({ scope: "mezes:destroy" })).status).toBe(400);
  });
});

describe("that client at the authorize endpoint", () => {
  const instance = authInstance();
  const register = registerWith(instance);

  /** ONE registration, reused: the flow only ever needs the client to exist. */
  let clientId = "";
  beforeAll(async () => {
    const response = await register({ scope: "openid mezes:read" });
    clientId = ((await response.json()) as { client_id: string }).client_id;
    expect(clientId).toBeTruthy();
  });

  const authorize = (params: Record<string, string>): Promise<Response> =>
    instance.ask(
      `/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: clientId, ...params }).toString()}`,
      { redirect: "manual" },
    );

  test("with no session, is sent to the sign-in page rather than refused", async () => {
    const response = await authorize({
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid mezes:read",
      state: "opaque-to-us",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });

    expect(response.status).toBe(302);
    // The whole request rides along, signed, so consent can be reconstructed
    // after sign-in without the client repeating itself.
    expect(response.headers.get("location")).toContain("/sign-in?");
  });

  test("with no PKCE, never reaches a login page at all", async () => {
    const response = await authorize({
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid mezes:read",
      state: "opaque-to-us",
    });

    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("/sign-in");
    expect(location).toContain("error=invalid_request");
  });

  test("asking for a scope it did not register for is refused, not silently narrowed", async () => {
    const response = await authorize({
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      // Registered for `openid mezes:read`. `mezes:write` is a scope the server
      // issues and this client was never granted.
      scope: "openid mezes:write",
      state: "opaque-to-us",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });

    expect(response.headers.get("location") ?? "").toContain("error=invalid_scope");
  });

  test("naming a redirect_uri it did not register is refused", async () => {
    const response = await authorize({
      response_type: "code",
      redirect_uri: "https://somewhere-else.example.test/callback",
      scope: "openid mezes:read",
      state: "opaque-to-us",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });

    // Never to the unregistered URL: the error goes to this server's own page.
    expect(response.headers.get("location") ?? "").not.toContain("somewhere-else.example.test");
  });
});

describe("the limit on registering", () => {
  const register = registerWith(authInstance());

  /**
   * ADR-7's whole point, measured. `/oauth2/register` takes no credential, so
   * this number is the only thing between it and the open internet — and it
   * only applies because `api/config.ts` states `rateLimit.enabled` rather than
   * letting Better Auth infer it from a `NODE_ENV` nothing here sets.
   */
  test("is 5 a minute, and it is in force", async () => {
    const statuses: Array<number> = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await register({ client_name: `agent ${attempt}` })).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
