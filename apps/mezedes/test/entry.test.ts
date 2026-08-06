import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Env } from "../alchemy.run.ts";
import type { AuthResult } from "../src/server/auth.ts";
import type { RouteDeps } from "../src/server/entry.ts";

/**
 * The Durable Object base class comes from a module only workerd provides, and
 * importing the entry pulls it in. Only that runtime module is stubbed: the
 * routing dependencies arrive through `RouteDeps`, because bun's `mock.module`
 * is process-global and stubbing `serve.ts`, `auth.ts` or `tools.ts` would
 * corrupt the suites that test them directly.
 */
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
  WorkerEntrypoint: class {},
  RpcTarget: class {},
}));

const { handle, default: worker } = await import("../src/server/entry.ts");

const SUFFIX = "a.example.com";
const TOKEN =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjhmM2EifQ.eyJzdWIiOiJvd25lciIsImF1ZCI6WyJwb2xpY3kiXX0.c2lnbmF0dXJl";

const DENIAL = "no-token";
const DETAIL = "No Cf-Access-Jwt-Assertion header. Access did not front this request.";
const REFUSED: AuthResult = { ok: false, denial: DENIAL, detail: DETAIL };

const ALLOWED: AuthResult = { ok: true, principal: { sub: "owner", email: "owner@example.com" } };

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const assets = () => {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (request: Request) => {
      calls.push(request.url);
      return new Response("<!doctype html>the shell", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
};

const environment = (auth: "access" | "none", shell: ReturnType<typeof assets>): Env =>
  ({
    AUTH: auth,
    ASSETS: shell,
    ARTIFACT_SUFFIX: SUFFIX,
    POLICY_AUD: "a".repeat(64),
    TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  }) as unknown as Env;

/** Records what the gate was asked, so "never consulted" is an assertion. */
const gate = (result: AuthResult) => {
  const calls: Request[] = [];
  return {
    calls,
    authorize: (async (request: Request) => {
      calls.push(request);
      return result;
    }) as RouteDeps["authorize"],
  };
};

const artifact = (response: Response | null) => {
  const calls: Request[] = [];
  return {
    calls,
    serveArtifact: (async (request: Request) => {
      calls.push(request);
      return response;
    }) as RouteDeps["serveArtifact"],
  };
};

let logged: string[] = [];
const realLog = console.log;

beforeEach(() => {
  logged = [];
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = realLog;
});

describe("routing order", () => {
  test("an artifact host answers with the gate never consulted, even when it would refuse", async () => {
    const shell = assets();
    const origin = artifact(new Response("the artifact", { status: 200 }));
    const access = gate(REFUSED);

    const response = await handle(
      new Request(`https://signal-garden.${SUFFIX}/`),
      environment("access", shell),
      ctx,
      { serveArtifact: origin.serveArtifact, authorize: access.authorize },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("the artifact");
    expect(access.calls).toEqual([]);
    expect(shell.calls).toEqual([]);
  });

  test("the artifact origin owns every path on its host, including /mcp", async () => {
    const shell = assets();
    const origin = artifact(new Response("the artifact", { status: 200 }));
    const access = gate(REFUSED);

    const response = await handle(
      new Request(`https://signal-garden.${SUFFIX}/mcp`, { method: "POST" }),
      environment("access", shell),
      ctx,
      { serveArtifact: origin.serveArtifact, authorize: access.authorize },
    );

    expect(await response.text()).toBe("the artifact");
    expect(access.calls).toEqual([]);
  });

  test("a host that is not an artifact falls through to the gate", async () => {
    const shell = assets();
    const origin = artifact(null);
    const access = gate(ALLOWED);

    const response = await handle(
      new Request("https://mezedes.example.com/"),
      environment("access", shell),
      ctx,
      { serveArtifact: origin.serveArtifact, authorize: access.authorize },
    );

    expect(access.calls).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(shell.calls).toEqual(["https://mezedes.example.com/"]);
  });
});

describe("the gate", () => {
  test("AUTH=none composes it out of the request path entirely", async () => {
    const shell = assets();
    const origin = artifact(null);
    const access = gate(REFUSED);

    const response = await handle(
      new Request("https://localhost:8787/"),
      environment("none", shell),
      ctx,
      { serveArtifact: origin.serveArtifact, authorize: access.authorize },
    );

    expect(access.calls).toEqual([]);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("the shell");
  });

  test("a refusal stops the request before anything is routed", async () => {
    const shell = assets();
    const origin = artifact(null);
    const access = gate(REFUSED);

    const response = await handle(
      new Request("https://mezedes.example.com/api/mezedes"),
      environment("access", shell),
      ctx,
      { serveArtifact: origin.serveArtifact, authorize: access.authorize },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Mezedes-Denial")).toBe(DENIAL);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(shell.calls).toEqual([]);
  });

  test("the 401 describes our configuration, and never carries the token", async () => {
    const shell = assets();
    const origin = artifact(null);
    const access = gate(REFUSED);

    const request = new Request("https://mezedes.example.com/", {
      headers: {
        "Cf-Access-Jwt-Assertion": TOKEN,
        "Cf-Connecting-Ip": "203.0.113.7",
        "Cf-Ray": "8f3a1c2d4e5f6a7b-LHR",
        Cookie: `CF_Authorization=${TOKEN}`,
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    const response = await handle(request, environment("access", shell), ctx, {
      serveArtifact: origin.serveArtifact,
      authorize: access.authorize,
    });
    const body = await response.text();

    expect(body).toContain(`unauthorized: ${DENIAL}`);
    expect(body).toContain(DETAIL);
    expect(body).not.toContain(TOKEN);

    const report = logged.join("\n");
    expect(report).toContain("cf-access-jwt-assertion");
    expect(report).toContain("cf-connecting-ip");
    expect(report).toContain("cf-ray");
    expect(report).not.toContain(TOKEN);
  });

  test("the header names are listed even when there are none to list", async () => {
    const shell = assets();
    const origin = artifact(null);
    const access = gate(REFUSED);

    await handle(new Request("https://mezedes.example.com/"), environment("access", shell), ctx, {
      serveArtifact: origin.serveArtifact,
      authorize: access.authorize,
    });

    expect(logged.join("\n")).toContain("(none)");
  });
});

describe("the Worker module surface", () => {
  /**
   * `handle` is no longer the export itself — `observe` wraps it to open the
   * request's span and flush it. Identity was only ever standing in for "the
   * default export routes like `handle` does", so assert that instead: the
   * wrapper is transparent, and a test that pins identity would forbid ever
   * wrapping it again.
   */
  test("the default export routes through the fetch handler", async () => {
    expect(typeof worker.fetch).toBe("function");

    const shell = assets();
    const env = environment("none", shell);
    const url = "https://mezedes.test/";

    const direct = await handle(new Request(url), env, ctx);
    const exported = await worker.fetch(new Request(url), env, ctx);

    expect(exported.status).toBe(direct.status);
    expect(await exported.text()).toBe(await direct.text());
  });
});
