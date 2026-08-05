import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { CloudflareStack } from "@swi/infra/cloudflare.stack";

import { Path } from "effect/Path";

import type { EmailAgent } from "./workers/agent/index.ts";
import type { MailboxDO } from "./workers/durableObject/index.ts";
import type { EmailMCP } from "./workers/mcp/index.ts";

const InboxAccess = Cloudflare.Access.Application(
  "InboxAccess",
  Effect.gen(function* () {
    const {
      cloudflareIdp: { identityProviderId },
      internalPolicy: { policyId },
    } = yield* CloudflareStack.stage["production"]!;
    return {
      type: "self_hosted" as const,
      domain: "mail.somewhatintelligent.ca",
      allowedIdps: [identityProviderId.as<string>()],
      autoRedirectToIdentity: true,
      policies: [policyId.as<string>()],
      oauthConfiguration: {
        enabled: true,
        dynamicClientRegistration: { enabled: true },
      },
    };
  }),
);

class Inbox extends Cloudflare.Website.Vite<Inbox>()(
  "Inbox",
  Effect.gen(function* () {
    const path = yield* Path;
    const {
      organization: { authDomain },
    } = yield* CloudflareStack.stage["production"]!;
    const { aud } = yield* InboxAccess;
    return {
      name: "agentic-inbox-si",
      rootDir: import.meta.dirname,
      main: path.join(".", "workers", "app.ts"),
      compatibility: { date: "2025-11-28", flags: ["nodejs_compat"] },
      domain: "mail.somewhatintelligent.ca",
      workersDev: false,
      observability: { enabled: true },
      env: {
        DOMAINS: "mail.somewhatintelligent.ca",
        EMAIL_ADDRESSES: [],
        POLICY_AUD: aud.as<string>(),
        // `authDomain` is bare (`acme.cloudflareaccess.com`); the scheme is
        // what `getAccessUrls` parses and what Access puts in `iss`.
        TEAM_DOMAIN: Output.interpolate`https://${authDomain}`.as<string>(),
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        BUCKET: Cloudflare.R2.Bucket("Bucket", { name: "agentic-inbox-si" }),
        AI: Cloudflare.AI.Gateway("Ai", { id: "agentic-inbox-si" }),
        EMAIL: Cloudflare.Email.SendEmail("Email"),
        MAILBOX: Cloudflare.DurableObject<MailboxDO>("MailboxDO"),
        EMAIL_AGENT: Cloudflare.DurableObject<EmailAgent>("EmailAgent"),
        EMAIL_MCP: Cloudflare.DurableObject<EmailMCP>("EmailMCP"),
      },
    };
  }).pipe(Effect.orDie),
) {}

export type InboxEnv = Cloudflare.Workers.InferEnv<Inbox>;

export default Alchemy.Stack(
  "AgenticInbox",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const access = yield* InboxAccess;
    const site = yield* Inbox;
    return { access, site };
  }).pipe(Alchemy.AdoptPolicy.adopt(true)),
);
