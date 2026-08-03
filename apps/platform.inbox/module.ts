import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type * as Output from "alchemy/Output";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Path } from "effect/Path";
import { CLOUDFLARE_IDP, PRODUCTION_STAGE, PRODUCTION_ZONE, TEAM_DOMAIN } from "platform.names";

// Type-only, and load-bearing: each namespace types as
// `DurableObjectNamespace<Class>` so app code gets a typed stub rather than
// `unknown`. Erased at build, so nothing here reaches the Worker bundle.
import type { EmailAgent } from "./workers/agent/index.ts";
import type { MailboxDO } from "./workers/durableObject/index.ts";
import type { EmailMCP } from "./workers/mcp/index.ts";

/**
 * THE PHYSICAL NAME, and the one thing here that must never change.
 *
 * Durable Object storage is keyed to the script that hosts the class, so
 * renaming this worker does not migrate three namespaces of mail — it orphans
 * them and starts empty. The `-si` suffix is a fossil of the retired `@si`
 * scope and stays for exactly that reason.
 */
const WORKER_NAME = "agentic-inbox-si";

/** The web UI's hostname AND the domain that receives mail. */
const APP_DOMAIN = `mail.${PRODUCTION_ZONE}`;

/** Addresses the UI pre-creates mailboxes for. */
const EMAIL_ADDRESSES: string[] = [];

/**
 * THE STAGE GUARD, and the reason this app is not stage-parameterised at all.
 *
 * Every physical name below is fixed: the worker, the R2 bucket, the AI gateway
 * id, the Access policy name, the hostname, and the zone whose catch-all is a
 * per-zone singleton. Combined with the stack's `adopt(true)`, that made a
 * deploy at ANY stage a deploy to production — `alchemy plan --stage dev_stoli`
 * and `--stage prod` produced byte-identical plans against the live account,
 * down to reassigning where the zone delivers every unrouted address.
 *
 * The fix is not per-stage copies. There is one inbox: one set of Durable
 * Objects holding the actual mail, one Access application, one catch-all. A
 * `dev_stoli` clone would be a second empty mailbox that steals the zone's
 * mail, which is worse than not existing. So a non-production DEPLOY is
 * refused outright, and `alchemy dev` — which is how you work on the UI — is
 * allowed through and skips the two zone-level resources.
 *
 * If a real staging inbox is ever wanted, it needs its own zone, not a stage
 * suffix on this one.
 */
const Deployment = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;
  const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);

  if (stage !== PRODUCTION_STAGE && !local) {
    return yield* Effect.die(
      new Error(
        `platform.inbox deploys at "${PRODUCTION_STAGE}" only; got "${stage}". ` +
          `Every name it owns is fixed and the stack adopts, so this deploy would ` +
          `reconfigure the live inbox and repoint ${PRODUCTION_ZONE}'s mail catch-all. ` +
          `Use ALCHEMY_STAGE=prod to deploy it, or \`vp run inbox:dev\` to work on it.`,
      ),
    );
  }

  return { local };
});

/**
 * The account's staff policy, owned by `stacks/platform.access`. A requirement
 * rather than an import because an app may not reach into `stacks/` — the stack
 * resolves the ref and provides it. `Output` because the id comes from upstream
 * state, not from here.
 */
export class StaffPolicy extends Context.Service<
  StaffPolicy,
  { readonly policyId: Output.Output<string> }
>()("platform.inbox/StaffPolicy") {}

/**
 * THE EDGE GATE, and now a resource rather than a dashboard artefact.
 *
 * This used to be the one hand-managed piece here, with its `aud` copied into
 * `POLICY_AUD` as a literal — because `Access.Application`'s reconcile observes
 * only by a persisted `applicationId` (or the warp singleton), so declaring it
 * against a live hostname plans a blind `create` and Cloudflare accepts a
 * SECOND application on the same domain with a fresh `aud`. Nothing about that
 * changed; the pre-existing application was deleted so that this create is the
 * only application on the hostname.
 *
 * Which is why `POLICY_AUD` below reads `access.aud` instead of a constant. The
 * value the worker validates against and the value Access mints are now the
 * same output, so they cannot drift — the failure the literal could produce was
 * a silent `Invalid or expired Access token` on every request.
 *
 * `autoRedirectToIdentity` with a single IdP skips the chooser. Managed OAuth
 * is what lets an MCP client authenticate at `/mcp` without a cookie flow, and
 * dynamic client registration (RFC 7591) lets it register itself rather than
 * carry a pre-provisioned id — the inbox serves an MCP endpoint that, until
 * now, only a browser session could reach.
 *
 * `oauthConfiguration` is absent from alchemy 2.0.0-beta.65 as published and
 * comes from `patches/alchemy@2.0.0-beta.65.patch`. The provider builds its
 * request body from an explicit field allowlist, so an unpatched install drops
 * the prop SILENTLY. Re-check with `grep oauthConfiguration` in
 * `node_modules/alchemy/src/Cloudflare/Access/Application.ts` after any bump.
 */
const AccessApp = Cloudflare.Access.Application(
  "InboxAccess",
  Effect.gen(function* () {
    const staff = yield* StaffPolicy;
    return {
      type: "self_hosted" as const,
      /** Bare, with no path — Cloudflare refuses a path when OAuth is on. */
      domain: APP_DOMAIN,
      allowedIdps: [CLOUDFLARE_IDP],
      autoRedirectToIdentity: true,
      policies: [staff.policyId],
      oauthConfiguration: {
        enabled: true,
        dynamicClientRegistration: { enabled: true },
      },
    };
  }),
);

/**
 * The app: React Router, built by this package's own `vite.config.ts` with
 * alchemy's Cloudflare plugin appended, and deployed as the Worker.
 *
 * Class form so `InboxEnv` below can be derived from the bindings — the runtime
 * env cannot drift from the infrastructure that produced it, and there is no
 * `wrangler.jsonc` or typegen step to keep in sync.
 */
export class Inbox extends Cloudflare.Website.Vite<Inbox>()(
  "Inbox",
  Effect.gen(function* () {
    const path = yield* Path;
    const { local } = yield* Deployment;
    const access = yield* AccessApp;

    return {
      name: WORKER_NAME,
      /**
       * ANCHORED, both of them. `rootDir` is Vite's root and defaults to
       * `process.cwd()`; `main` is the one path here that resolves from
       * `rootDir` rather than from cwd. Both were implicit while `alchemy
       * deploy` ran inside this directory, and stopped being true the moment
       * the stack moved to `stacks/platform.inbox/`.
       *
       * A wrong root fails at BUILD, not at plan — no `alchemy plan` will
       * report it.
       */
      rootDir: import.meta.dirname,
      /**
       * A custom entry, so the deployed Worker exports the three Durable
       * Object classes and the `email()` handler alongside React Router's
       * fetch handler. The framework's own server bundle exports none of them.
       */
      main: path.join(".", "workers", "app.ts"),
      compatibility: { date: "2025-11-28", flags: ["nodejs_compat"] },
      /**
       * The hostname is claimed by a real deploy only. `alchemy dev` serves on a
       * local port and would otherwise still reconcile the custom domain — which
       * for this app means repointing the live `mail.` record at whatever the dev
       * session happens to be. `url: false` for the deploy because
       * `mail.<zone>` is the single Access-gated surface, and a workers.dev
       * hostname is on Cloudflare's zone where no Access application can sit.
       */
      ...(local ? {} : { domain: APP_DOMAIN }),
      url: false,
      observability: { enabled: true },
      env: {
        DOMAINS: APP_DOMAIN,
        EMAIL_ADDRESSES,
        /**
         * The application's OWN aud, not a copy of it. `workers/app.ts` verifies
         * the Access JWT against this, so sourcing the value it checks and the
         * value Access mints from one resource is what makes them unable to
         * disagree.
         *
         * THE CAST IS THE POINT, and it is not a lie: it declares what the
         * WORKER receives, which is the resolved string, not the Output the
         * deploy passes.
         *
         * `WorkerBindingProps` accepts a `WorkerBindingResource` or an `Effect`
         * of one, and `Output` is neither. An Output-valued binding therefore
         * fails the `const Bindings` constraint, inference falls back to `{}`,
         * and `InferEnv` below degrades to a union of every binding type alchemy
         * knows — surfacing as ~70 errors in `workers/` about
         * `env.MAILBOX.idFromName` and `env.BUCKET`, none of which name this
         * line. `mezedes` passes an Output here and never notices, because it
         * hand-writes its `Env` rather than deriving one.
         *
         * `Effect.flatten(access.aud.asEffect())` satisfies the constraint and
         * DEPLOYS BROKEN: an Accessor only resolves inside a `RuntimeContext`,
         * so binding fails with `Service not found: RuntimeContext`. Typechecking
         * green is not evidence here; only a deploy is.
         */
        POLICY_AUD: access.aud.as<string>() as unknown as string,
        TEAM_DOMAIN,
        /** The build fingerprint the UI renders — see `app/lib/version.ts`. */
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        /** Pinned to the live bucket's name, and adopted in place. */
        BUCKET: Cloudflare.R2.Bucket("Bucket", { name: WORKER_NAME }),
        /**
         * The native `ai` binding. Binding an AI Gateway resource is how
         * alchemy models Workers AI — at runtime `env.AI` is plain Workers AI
         * and the gateway itself never sees a request.
         */
        AI: Cloudflare.AI.Gateway("Ai", { id: WORKER_NAME }),
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        /** SQLite DOs hosted by this worker; classes re-exported by `workers/app.ts`. */
        MAILBOX: Cloudflare.DurableObject<MailboxDO>("MailboxDO"),
        EMAIL_AGENT: Cloudflare.DurableObject<EmailAgent>("EmailAgent"),
        EMAIL_MCP: Cloudflare.DurableObject<EmailMCP>("EmailMCP"),
      },
    };
    /**
     * `orDie` is not decoration. `Website.Vite`'s props overload only accepts an
     * Effect whose ERROR channel is `never`; yielding `AccessApp` above widens
     * it, inference falls back to `Bindings = {}`, and `InferEnv` below silently
     * degrades to a union of every binding type alchemy knows. That surfaces
     * seventy type errors in the Worker code — `env.MAILBOX.idFromName` gone,
     * `env.BUCKET` no longer an R2Bucket — none of which mention this line.
     *
     * A failure resolving the gate is a deploy-time fatal anyway; there is no
     * inbox without it.
     */
  }).pipe(Effect.orDie),
) {}

/** The runtime env, derived from the bindings above. Read by `workers/types.ts`. */
export type InboxEnv = Cloudflare.Workers.InferEnv<Inbox>;

/**
 * THE DEPLOYABLE UNIT, and everything it owns.
 *
 * Parameterless: this app has no peers and no upstreams. The stack name, the
 * state layer and the adopt policy live in `stacks/platform.inbox/` — they are
 * composition, not this app's business.
 */
export const InboxModule = Effect.gen(function* () {
  const { local } = yield* Deployment;

  /**
   * The gate and its policy come along with the Worker — `Inbox` yields
   * `AccessApp` for its `POLICY_AUD`, which yields `InboxOwner` for its
   * `policies`. Declaring them again here would be a second reference to the
   * same two resources, not a second pair.
   */
  const site = yield* Inbox;
  const access = yield* AccessApp;

  /**
   * ZONE-LEVEL, and therefore skipped under `alchemy dev`. A dev session cannot
   * receive mail — inbound delivery goes to the deployed script by name, not to
   * a local port — so reconciling these would take on the zone's routing to no
   * benefit. See `Deployment` for why that matters more here than elsewhere.
   */
  if (local) {
    return { url: `https://${APP_DOMAIN}`, workerName: site.workerName, accessAud: access.aud };
  }

  /**
   * Inbound mail. The zone is named rather than owned — alchemy looks it up —
   * and enabling routing provisions the MX and SPF records.
   */
  const routing = yield* Cloudflare.Email.Routing("EmailRouting", {
    zone: PRODUCTION_ZONE,
  });

  /**
   * A PER-ZONE SINGLETON. There is exactly one catch-all rule on
   * `somewhatintelligent.ca`, so whichever deploy runs last owns where every
   * unrouted address on the zone is delivered. Alchemy restores the prior rule
   * on destroy, which makes that recoverable rather than safe.
   */
  yield* Cloudflare.Email.CatchAll("EmailCatchAll", {
    zone: routing.zoneId,
    name: "agentic-inbox catch-all",
    enabled: true,
    actions: [{ type: "worker", value: [site.workerName] }],
  });

  return {
    url: `https://${APP_DOMAIN}`,
    workerName: site.workerName,
    accessAud: access.aud,
  };
});
