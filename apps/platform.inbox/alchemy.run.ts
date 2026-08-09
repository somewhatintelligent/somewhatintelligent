import { telemetryEnv } from "@swi/infra/observability/telemetry";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { accessFacts } from "@swi/infra/cloudflare.stack";
import { UNGATED } from "@swi/infra/stage/preview";
import { Deployment, GateFor, Tiered } from "@swi/infra/stage/StandardizedStage";
import { state } from "@swi/infra/stage/state";
import { PREVIEW_SCRIPTS, workerSafeStage, workersDevHost } from "platform.names";
import { previewFactsFor } from "platform.auth/alchemy.run";

import { Path } from "effect/Path";

import type { EmailAgent } from "./workers/agent/index.ts";
import type { MailboxDO } from "./workers/durableObject/index.ts";
import type { EmailMCP } from "./workers/mcp/index.ts";

const MAIL_HOST = "mail.somewhatintelligent.ca";

/** The app the live inbox already sits behind. Pinned so `production` adopts it. */
const PRODUCTION_ACCESS_APP = "AgenticInbox-InboxAccess-dev-stoli-qamzqweyw7kcrmor";

class Inbox extends Cloudflare.Website.Vite<Inbox>()(
  "Inbox",
  Effect.gen(function* () {
    const path = yield* Path;
    const { stage } = yield* Deployment;
    const safeStage = workerSafeStage(stage);

    /**
     * Facts resolve only when something will verify against them, and
     * `GateFor` — not a hand-rolled `dev ?` — decides: `workers/app.ts` skips
     * its Access middleware entirely under `import.meta.env.DEV`, so a dev or
     * sandbox run reads neither value, and declaring an application there
     * would put a real account-level resource in front of a hostname the run
     * does not deploy. On production `accessFacts` adopts the pinned app on
     * the mail hostname; on a manually-deployed preview it reads the stage's
     * shared application out of the auth stack.
     */
    const { aud, teamDomain } =
      (yield* GateFor()) === "none"
        ? UNGATED
        : yield* accessFacts(
            "InboxAccess",
            MAIL_HOST,
            PRODUCTION_ACCESS_APP,
            previewFactsFor("inbox"),
          );

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

    /**
     * What `/api/v1/config` reports as this deployment's reachable host —
     * DERIVED from `name`, because off production they are the same fact: the
     * worker answers on `workers.dev` under its own script name. Stated twice
     * they can drift into a config endpoint advertising a hostname that
     * resolves to nothing; mezedes derives its `origin` the same way.
     */
    const mailDomain = yield* Tiered({
      production: MAIL_HOST,
      staging: workersDevHost(name),
      ephemeral: workersDevHost(name),
    });

    /**
     * ONE record for the R2 bucket and the AI gateway: they were two
     * byte-identical tables that had to be edited together with nothing saying
     * so, and the next per-stage rename would have fixed one and left the
     * other with a different suffix.
     */
    const inboxId = yield* Tiered({
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
        BUCKET: Cloudflare.R2.Bucket("Bucket", { name: inboxId }).pipe(
          Alchemy.RemovalPolicy.retain(retainBucket),
        ),
        AI: Cloudflare.AI.Gateway("Ai", { id: inboxId }),
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
    /**
     * `Inbox` is the only thing that resolves the Access facts now, and it does
     * so conditionally. Yielding them here as well would resolve them on every
     * run — including `alchemy dev`, where there is no shared application to
     * read and the guard in `requirePreview` would refuse the deploy.
     */
    const site = yield* Inbox;
    return { site };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);
