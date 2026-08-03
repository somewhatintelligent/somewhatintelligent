import type { Env } from "./src/server/env.ts";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { Path } from "effect/Path";
import { CLOUDFLARE_IDP, PRODUCTION_STAGE, PRODUCTION_ZONE, TEAM_DOMAIN } from "platform.names";
import type { Owner as OwnerClass } from "./src/server/entry.ts";

/**
 * Artifacts get their OWN zone, and the separation is load-bearing twice over.
 *
 * The certificate: an artifact host is `<slug>.<artifactZone>`, one label under
 * the zone, which is exactly what Universal SSL issues for. The previous
 * arrangement put artifacts at `<slug>.a.<zone>` — two labels — where Cloudflare
 * accepts the wildcard custom domain and then cannot validate a certificate for
 * it, so every shared link failed the TLS handshake while the deploy reported
 * success.
 *
 * The gate: Access applications are per hostname, and none exists on this zone
 * at all. That is what lets a preview frame on an opaque origin fetch its own
 * `./client.js` — a credential-less request the edge would otherwise 401 before
 * `entry.ts` ever ran.
 */
const ARTIFACT_ZONE = "somewhatintelligent.dev";

/**
 * NOT MANAGED HERE, and that is a defect rather than a design.
 *
 * The artifact wildcard is a Worker route (below), and a route creates no DNS —
 * so `*.<ARTIFACT_ZONE>` needs a proxied `AAAA` to `100::`, the IPv6 discard
 * prefix, for the hostname to reach Cloudflare's edge at all. That record
 * SHOULD be a `Cloudflare.DNS.Record` in this stack. It is not, because
 * alchemy's OAuth scopes do not include `dns_records:edit` and the plan fails
 * on `GET /zones/{id}/dns_records` with Forbidden before anything applies.
 *
 * So the record was created by hand, in zone `6f4aed2ecbf9dc1db5a2028215846188`:
 *
 *     AAAA  *.somewhatintelligent.dev  100::  proxied
 *
 * Consequences worth knowing before you trust this file: `alchemy destroy`
 * leaves it behind, nothing re-creates it if it is deleted, and a reader of
 * this stack would not know the artifact hostnames depend on it. To fix, run
 * `alchemy login` with `dns_records:edit` added and restore the resource — the
 * git history for this comment has it.
 */

const COMPATIBILITY_DATE = "2026-07-01";

/**
 * The local dev server's port. Fixed rather than chosen, because `.mcp.json`
 * at the repo root names it and an MCP client cannot discover a port that
 * moved. Change it in both places or in neither.
 */
const DEV_PORT = 8787;

/**
 * The hostnames this deploy owns. Derived from the stage so two stages can
 * never advertise the same one, and yielded rather than computed at module
 * scope because the stage exists only inside the stack.
 *
 * `artifactSuffix` is the artifact zone itself in prod, so an artifact host is
 * one label under it and inside what Universal SSL issues. Non-prod keeps the
 * old two-label form on the shell's zone: it never resolves publicly, because
 * the dev harness addresses artifact hosts through a service binding rather
 * than DNS, so a certificate it can never be issued costs nothing.
 *
 * `named` is what decides whether these hostnames are CLAIMED. Only prod
 * attaches custom domains; every other stage answers on its workers.dev URL
 * alone. Requesting them unconditionally meant a non-prod `alchemy deploy` tried
 * to attach `mezedes-<stage>.<zone>` — which fails outright when the stage name
 * carries an underscore, and would otherwise have a stage quietly claiming a
 * hostname on a zone it has no business in. `alchemy dev` hid this by never
 * reconciling domains at all.
 */
const Hostnames = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;
  const zone = yield* Config.string("MEZEDES_ZONE").pipe(Config.withDefault(PRODUCTION_ZONE));
  const artifactZone = yield* Config.string("MEZEDES_ARTIFACT_ZONE").pipe(
    Config.withDefault(ARTIFACT_ZONE),
  );
  const prod = stage === PRODUCTION_STAGE;
  const suffix = prod ? "" : `-${stage}`;
  return {
    apex: `mezedes${suffix}.${zone}`,
    artifactSuffix: prod ? artifactZone : `a${suffix}.${zone}`,
    named: prod,
  };
  // An unreadable zone is a deploy-time fatal, not something a resource can
  // recover from — and `Access.Application` only accepts a props Effect that
  // cannot fail.
}).pipe(Effect.orDie);

/** Blobs, assets and published manifests. The only reader-facing store. */
const Blobs = Cloudflare.R2.Bucket("Blobs");

/**
 * The index. Alchemy creates every new Durable Object class under
 * `new_sqlite_classes`, which is what the FTS5 table requires.
 */
const OwnerObject = Cloudflare.DurableObject<OwnerClass>("Owner", { className: "Owner" });

/**
 * THE definition of who owns anything here, and the only one. `entry.ts`
 * derives the tenant from whatever token this policy lets through, so this
 * rule alone decides both who may enter and how many tenants exist — nothing
 * downstream re-states it and can drift from it. Widening this to a second
 * person gives them their own index and blob prefix, not a share of the
 * first's. `accountId` defaults to the account the policy lives in.
 *
 * `name` is omitted here and on the application below so alchemy derives a
 * per-stage physical name; a shared one would make two stages contend for the
 * same account-level object.
 */
const OwnerPolicy = Cloudflare.Access.Policy("MezedesOwner", {
  decision: "allow",
  include: [{ cloudflareAccountMember: {} }],
});

/**
 * The apex, and nothing else. Managed OAuth authenticates an MCP client with no
 * cookie flow, and dynamic client registration is what lets a connector
 * register itself (RFC 7591) rather than carry a pre-provisioned client id.
 *
 * Managed OAuth is also what makes the tenant derivation correct on this path:
 * the token then carries the CONSENTING USER's `email`, so a mezes an agent
 * creates over MCP lands in the same index the shell browses. An Access service
 * token would carry no `email` at all and `auth.ts` refuses it, rather than
 * silently filing the agent's work under a second tenant.
 *
 * `oauthConfiguration` is absent from alchemy 2.0.0-beta.65 as published, so it
 * needs `patches/alchemy@2.0.0-beta.65.patch`. Upstream merged the same feature
 * in alchemy-run/alchemy#1023 — after the beta.67 tag, so the patch is
 * deletable on the first release that contains it, not before. Verify with
 * `grep oauthConfiguration node_modules/alchemy/src/Cloudflare/Access/Application.ts`
 * after any bump: the prop is dropped SILENTLY if absent, because the provider
 * builds its request body from an explicit field allowlist.
 */
const AccessApp = Cloudflare.Access.Application(
  "MezedesAccess",
  Effect.gen(function* () {
    const owner = yield* OwnerPolicy;
    const { apex } = yield* Hostnames;
    return {
      type: "self_hosted" as const,
      /**
       * The BARE apex, with no path. Cloudflare refuses a path when managed
       * OAuth is on — "domain can not have a path if oauth is configured" — and
       * the OAuth is what lets an MCP client register itself.
       */
      domain: apex,
      allowedIdps: [CLOUDFLARE_IDP],
      autoRedirectToIdentity: true,
      policies: [owner.policyId],
      oauthConfiguration: {
        enabled: true,
        dynamicClientRegistration: { enabled: true },
      },
    };
  }),
);

/**
 * THE DEPLOYABLE UNIT, and everything it owns.
 *
 * Parameterless on purpose. Every resource below reads the stage it needs from
 * `Alchemy.Stage` itself rather than being handed one, so a composer never
 * passes stage down — see `Hostnames`. The only things a module may take as
 * parameters are peers and upstreams, and this one has neither.
 *
 * The stack name, the state layer and the adopt policy live in
 * `stacks/mezedes/` — they are composition, not this app's business. What that
 * file cannot supply is anything in here, which is why this is an export rather
 * than a set of loose declarations for it to reassemble.
 */
export const MezedesModule = Effect.gen(function* () {
  const path = yield* Path;
  const { dev } = yield* AlchemyContext;
  const { apex, artifactSuffix, named } = yield* Hostnames;
  const access = yield* AccessApp;

  const origin = `https://${apex}`;

  const worker = yield* Cloudflare.Worker("Mezedes", {
    /**
     * ANCHORED, and it has to be. Alchemy resolves a relative path from the
     * process's cwd, not from the file that declares the resource — and the
     * file that invokes this module now lives in `stacks/mezedes/`. A bare
     * `"./src/server/entry.ts"` would resolve against whatever directory the
     * deploy happened to start in and find nothing.
     */
    main: path.resolve(import.meta.dirname, "src/server/entry.ts"),
    observability: { enabled: true },
    compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
    /**
     * A fixed port, because `.mcp.json` at the repo root hardcodes
     * `http://localhost:8787/mcp` and an MCP client has no way to discover a
     * port that moved. `strictPort` for the same reason: if 8787 is taken,
     * failing to start is honest, and quietly binding 8788 leaves the client
     * pointed at nothing with no error to read.
     */
    dev: { port: DEV_PORT, strictPort: true },
    /**
     * The apex and one wildcard level of artifact hostname, on the same
     * Worker — in prod these are two DIFFERENT zones, which alchemy resolves
     * per hostname, so no second Worker is involved. There is deliberately NO
     * Access application on `*.<artifactSuffix>`: artifacts are
     * unauthenticated by design, Access enforces at the EDGE, and an
     * application there would 401 every shared link before `entry.ts`'s
     * ordering got a say. Keeping the artifact zone separate makes that a
     * property of the deploy rather than something to remember.
     *
     * Domain and route are ONE decision, spread together: a route without the
     * apex, or an apex without the route, is a half-configured zone of exactly
     * the kind the paragraphs above describe.
     *
     * PROD ONLY. Other stages answer on the workers.dev URL alone — see
     * `Hostnames`. A stage that claims no hostname cannot collide with one
     * that does, and cannot fail a deploy on a stage name DNS will not take.
     *
     * The apex is a Custom Domain; the artifact wildcard is NOT, and cannot
     * be. "Custom Domains do not support wildcard DNS records — an incoming
     * request must exactly match the domain or subdomain." Attaching one
     * anyway is accepted: Cloudflare creates the originless `AAAA 100::`
     * record and issues a certificate, so DNS resolves and TLS completes,
     * and then no Worker matches and every artifact answers 522. The wildcard
     * is a `route` below, which is the form that matches by pattern.
     */
    ...(named
      ? {
          domain: [apex],
          routes: [{ pattern: `*.${artifactSuffix}/*`, zoneName: artifactSuffix }],
        }
      : {}),
    /**
     * The inverse of `domain`, and for the same reason. A workers.dev URL is
     * a hostname on Cloudflare's zone, not this account's, so no Access
     * application can ever be put in front of one — the shell and `/mcp`
     * would answer there with `authorize()` as the only thing between a
     * caller and the index, rather than the edge gate the design names as
     * the boundary. Off wherever a real hostname exists; on everywhere else,
     * because a stage with neither is a Worker nothing can reach.
     */
    url: !named,
    /** The shell. The SPA fallback is what lets a deep link into the client router resolve. */
    /**
     * `runWorkerFirst` because the asset router runs BEFORE the Worker on every
     * hostname this script answers, and `/` matches dist/shell/index.html — so
     * without it every mezes's root URL serves the shell instead of the mezes.
     */
    assets: {
      /** Anchored for the same reason as `main`, and `vite build` writes here. */
      directory: path.resolve(import.meta.dirname, "dist/shell"),
      notFoundHandling: "single-page-application",
      runWorkerFirst: true,
    },
    env: {
      BLOBS: Blobs,
      OWNER: OwnerObject,
      LOADER: Cloudflare.WorkerLoader("LOADER"),
      /** "none" in local dev, so the gate is absent from the request path rather than present and declining to act. */
      AUTH: dev ? "none" : "access",
      POLICY_AUD: access.aud.as<string>(),
      TEAM_DOMAIN,
      ARTIFACT_SUFFIX: artifactSuffix,
      /**
       * Named so an artifact response can let the shell — and only the shell
       * — frame it. Artifacts and shell are separate origins now, so the
       * blanket `X-Frame-Options: SAMEORIGIN` this replaces would refuse the
       * preview frame outright.
       */
      SHELL_ORIGIN: origin,
    },
  });

  /**
   * `worker.url` is an OUTPUT, known only once the worker exists, so it
   * reports where alchemy actually bound rather than where this file asked it
   * to. In dev that is a port it chose, and printing the apex there sends the
   * reader somewhere that does not answer.
   */
  return dev
    ? {
        shell: worker.url.as<string>(),
        mcp: Output.interpolate`${worker.url}mcp`,
        /**
         * Both are hostnames now — a preview is `p--<token>.<artifactZone>`,
         * not a path — and alchemy's dev proxy rewrites the URL before the
         * script sees it, so neither resolves locally. `integ/` reaches them
         * through a service binding; there is no equivalent in a browser.
         */
        artifacts: "not reachable by hostname under `alchemy dev` — deploy to see them",
        previews: "likewise: a preview is its own origin, which the dev proxy rewrites away",
      }
    : {
        shell: origin,
        mcp: `${origin}/mcp`,
        /** Minted per version by `/api`, so there is no pattern to print. */
        previews: "p--<token>.<artifactZone>, from the shell",
        artifacts: `https://<slug>.${artifactSuffix}`,
      };
});

export type { Env };
