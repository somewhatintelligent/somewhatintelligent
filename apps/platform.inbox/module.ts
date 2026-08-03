import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Path } from "effect/Path";
import { PRODUCTION_STAGE, PRODUCTION_ZONE, TEAM_DOMAIN } from "platform.names";

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

/**
 * Who may pass Cloudflare Access into the inbox. Editing this list fully
 * reconciles the policy on the next deploy — it is the allow-list, not a copy
 * of one kept elsewhere.
 *
 * This duplicates what `stacks/platform.access` calls `staff`, and should
 * become a reference to it once that singleton is actually deployed. Not yet:
 * a consumer pinning an unapplied stack fails its plan with
 * `InvalidReferenceError`.
 */
const ACCESS_ALLOWED_EMAILS = ["apostoli.geyer@geyerconsulting.com"];

/** Matches the live policy by name, which is what `adopt` needs to find it. */
const ACCESS_POLICY_NAME = `${WORKER_NAME}-access`;

/**
 * The `aud` of the live Access application for `mail.somewhatintelligent.ca`
 * (app id `ff35743f-8c54-46e3-9938-e2c8a7ff65df`), read from the Access API.
 *
 * A LITERAL because declaring the application here would lock everyone out.
 * `Access.Application`'s read step recovers an app by persisted
 * `applicationId`, or — only when it has previous props to read a domain from —
 * by scanning for that domain. A newly declared resource has neither, so the
 * engine plans a blind `create`, Cloudflare accepts a SECOND application on the
 * same hostname, and it mints a fresh `aud` that the deployed worker's
 * `POLICY_AUD` no longer matches. Verified against alchemy 2.0.0-beta.65 in
 * `Cloudflare/Access/Application.ts:330-347`; re-check that read step before
 * replacing this with a resource output.
 *
 * The application is therefore the one dashboard-managed piece of this
 * deployment. The policy below is not — it attaches to that application and is
 * reconciled from this file.
 */
const ACCESS_APP_AUD = "a0046cb0773459b27a32ff7123e52e18d985c2e4aa75df35ba35828ca096443f";

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
        POLICY_AUD: ACCESS_APP_AUD,
        TEAM_DOMAIN,
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
  }),
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
   * Attached to the dashboard-managed application by `aud`, not by reference.
   * `adopt` matches the live policy on `ACCESS_POLICY_NAME`.
   */
  yield* Cloudflare.Access.Policy("AccessPolicy", {
    name: ACCESS_POLICY_NAME,
    decision: "allow",
    include: ACCESS_ALLOWED_EMAILS.map((addr) => ({ email: { email: addr } })),
    adopt: true,
  });

  const site = yield* Inbox;

  /**
   * ZONE-LEVEL, and therefore skipped under `alchemy dev`. A dev session cannot
   * receive mail — inbound delivery goes to the deployed script by name, not to
   * a local port — so reconciling these would take on the zone's routing to no
   * benefit. See `Deployment` for why that matters more here than elsewhere.
   */
  if (local) {
    return { url: `https://${APP_DOMAIN}`, workerName: site.workerName, accessAud: ACCESS_APP_AUD };
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
    accessAud: ACCESS_APP_AUD,
  };
});
