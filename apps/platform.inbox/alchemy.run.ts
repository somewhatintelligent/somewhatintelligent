import { telemetryEnv } from "@swi/infra/observability/telemetry";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { CloudflareStack, InternalAccessApplication } from "@swi/infra/cloudflare.stack";
import { requirePreview } from "@swi/infra/stage/preview";
import { Deployment, Tiered, TieredEffect } from "@swi/infra/stage/StandardizedStage";
import { state } from "@swi/infra/stage/state";
import { PREVIEW_SCRIPTS, workerSafeStage, workersDevHost } from "platform.names";
import { Auth } from "platform.auth/alchemy.run";

import { Path } from "effect/Path";

import type { EmailAgent } from "./workers/agent/index.ts";
import type { MailboxDO } from "./workers/durableObject/index.ts";
import type { EmailMCP } from "./workers/mcp/index.ts";

const MAIL_HOST = "mail.somewhatintelligent.ca";

/** The app the live inbox already sits behind. Pinned so `production` adopts it. */
const PRODUCTION_ACCESS_APP = "AgenticInbox-InboxAccess-dev-stoli-qamzqweyw7kcrmor";

const previewFacts = Effect.gen(function* () {
  const { previewAud, previewTeamDomain } = yield* Auth;
  return requirePreview(previewAud, previewTeamDomain, "inbox");
});

/**
 * The Access application whose assertions this Worker accepts.
 *
 * ON PRODUCTION, its own, pinned to the name the live one carries and bound to
 * the mail hostname. OFF PRODUCTION it declares nothing and reads the stage's
 * shared application out of the auth stack — which is also why this stack now
 * depends on `platform.auth` and why CI deploys auth first.
 */
const AccessFacts = TieredEffect({
  production: Effect.gen(function* () {
    const access = yield* InternalAccessApplication(
      "InboxAccess",
      MAIL_HOST,
      PRODUCTION_ACCESS_APP,
    );
    const {
      organization: { authDomain },
    } = yield* CloudflareStack.stage["production"]!;
    return {
      aud: access.aud.as<string>() as unknown as string,
      // `authDomain` is bare (`acme.cloudflareaccess.com`); the scheme is what
      // `getAccessUrls` parses and what Access puts in `iss`.
      teamDomain: Output.interpolate`https://${authDomain}`.as<string>() as unknown as string,
    };
  }),
  staging: previewFacts,
  ephemeral: previewFacts,
});

class Inbox extends Cloudflare.Website.Vite<Inbox>()(
  "Inbox",
  Effect.gen(function* () {
    const path = yield* Path;
    const { stage } = yield* Deployment;
    const safeStage = workerSafeStage(stage);
    const { aud, teamDomain } = yield* AccessFacts;

    /**
     * EVERY IDENTITY THIS STACK CLAIMS WAS A CONSTANT, and every one of them is
     * account-global — so any stage deployed here fought production for the
     * worker name, the mail hostname, the bucket and the AI gateway, and the
     * loser silently adopted the winner's data. Below, production keeps exactly
     * what it has and every other stage gets its own.
     */
    const name = yield* Tiered({
      production: "agentic-inbox-si",
      staging: PREVIEW_SCRIPTS.inbox("staging"),
      ephemeral: PREVIEW_SCRIPTS.inbox(safeStage),
    });

    /**
     * The mail hostname is production's alone. A preview answers on workers.dev
     * and receives no inbound mail — zone-level Email Routing has a single
     * owner, so a per-stage inbound address is not something this can create
     * without taking the address away from production.
     */
    const routing = yield* Tiered({
      production: { domain: MAIL_HOST, workersDev: false },
      staging: { workersDev: true },
      ephemeral: { workersDev: true },
    });

    /** What `/api/v1/config` reports as this deployment's reachable host. */
    const mailDomain = yield* Tiered({
      production: MAIL_HOST,
      staging: workersDevHost(PREVIEW_SCRIPTS.inbox("staging")),
      ephemeral: workersDevHost(PREVIEW_SCRIPTS.inbox(safeStage)),
    });

    const bucketName = yield* Tiered({
      production: "agentic-inbox-si",
      staging: "agentic-inbox-si-staging",
      ephemeral: `agentic-inbox-si-${safeStage}`,
    });

    const gatewayId = yield* Tiered({
      production: "agentic-inbox-si",
      staging: "agentic-inbox-si-staging",
      ephemeral: `agentic-inbox-si-${safeStage}`,
    });

    /**
     * RETAINED ONLY WHERE THE DATA MATTERS. This was `retain(true)`
     * unconditionally, which meant every destroyed stage left its bucket in the
     * account forever — and since the NAME was also constant, they were all the
     * same bucket. Production and staging keep their mail; an ephemeral stage's
     * bucket goes when the stage does, which is the whole point of `destroy`.
     */
    const retainBucket = yield* Tiered({
      production: true,
      staging: true,
      ephemeral: false,
    });

    return {
      name,
      rootDir: import.meta.dirname,
      main: path.join(".", "workers", "app.ts"),
      compatibility: { date: "2025-11-28", flags: ["nodejs_compat"] },
      ...routing,
      observability: { enabled: true },
      env: {
        DOMAINS: mailDomain,
        EMAIL_ADDRESSES: [],
        POLICY_AUD: aud,
        TEAM_DOMAIN: teamDomain,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        BUCKET: Cloudflare.R2.Bucket("Bucket", { name: bucketName }).pipe(
          Alchemy.RemovalPolicy.retain(retainBucket),
        ),
        AI: Cloudflare.AI.Gateway("Ai", { id: gatewayId }),
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        MAILBOX: Cloudflare.DurableObject<MailboxDO>("MailboxDO"),
        EMAIL_AGENT: Cloudflare.DurableObject<EmailAgent>("EmailAgent"),
        EMAIL_MCP: Cloudflare.DurableObject<EmailMCP>("EmailMCP"),
        /**
         * The exporter as env, read at runtime by `observe()` in
         * `workers/app.ts`. Empty off production and staging.
         */
        ...(yield* telemetryEnv("inbox")),
      },
    };
  }).pipe(Effect.orDie),
) {}

export type InboxEnv = Cloudflare.Workers.InferEnv<Inbox>;

export default Alchemy.Stack(
  "AgenticInbox",
  {
    providers: Cloudflare.providers(),
    state: state(),
  },
  Effect.gen(function* () {
    yield* Deployment;
    const access = yield* AccessFacts;
    const site = yield* Inbox;
    return { access, site };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);
