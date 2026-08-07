/**
 * The C4 overlay: everything the IaC graph cannot know about itself.
 *
 * `topology.json` (from `extract.ts`) carries the mechanically-true facts —
 * resources, types, binding edges, cross-stack refs. This file carries the
 * *architectural intent* layered on top: which stack is which software
 * system, who the people are, what each resource is FOR, and the runtime
 * relationships that exist only in code paths (webhooks, redirects, OTLP
 * export) rather than in resource props.
 *
 * The generator renders the two sources distinguishably: extracted edges are
 * solid, asserted edges are dashed. An agent (or human) reading the diagram
 * can always tell provenance at a glance.
 */

export type C4Role =
  | "compute" // running application code (C4 container, application)
  | "datastore" // D1 / R2 / Queue / AI gateway (C4 container, data store)
  | "edge" // Access application, routing, security (C4 infrastructure node)
  | "schema" // build-time artifact feeding a datastore
  | "dev" // dev-only utility, not part of the deployed topology
  | "external" // software system outside the account
  | "person";

export interface SystemMeta {
  stack: string; // alchemy stack name (topology key), or synthetic id
  name: string; // human name
  description: string;
  /** Not extracted (foundation stacks are production-guarded); drawn from infra/. */
  synthetic?: boolean;
  external?: boolean;
}

export interface NodeMeta {
  /** "Stack/FQN" key matching topology nodes, or a synthetic id. */
  key: string;
  name: string;
  description: string;
  technology: string;
  role: C4Role;
  /** Production hostname, when the stage claims one. */
  domain?: string;
  /** OTel service name, when the worker emits telemetry. */
  serviceName?: string;
}

export interface AssertedEdge {
  from: string;
  to: string;
  label: string;
  technology: string;
  /** Where in the codebase this relationship is implemented. */
  evidence: string;
}

export interface ComponentMeta {
  name: string;
  description: string;
  kind: "domain" | "port" | "adapter" | "surface";
}

export const systems: SystemMeta[] = [
  {
    stack: "SomewhatIntelligentAuth",
    name: "Identity",
    description:
      "better-auth identity service: passkeys, 2FA, organizations, magic links, device auth, OAuth provider. Account UI at accounts.somewhatintelligent.ca.",
  },
  {
    stack: "PlatformCommerce",
    name: "Site & Commerce",
    description:
      "Public storefront at the apex plus the commerce substrate: catalog, checkout, settlement, fulfilment, audit — and the operator console behind Zero Trust.",
  },
  {
    stack: "AgenticInbox",
    name: "Inbox",
    description:
      "Staff mailbox at mail.somewhatintelligent.ca with an AI agent inside: per-mailbox Durable Objects, MCP tool surface, inbound catch-all email.",
  },
  {
    stack: "Mezedes",
    name: "Mezedes",
    description:
      "Agent-facing artifact platform: MCP `create` typechecks, bundles and publishes tiny web apps to <slug>.somewhatintelligent.dev.",
  },
  {
    stack: "Cloudflare",
    name: "Zero Trust Foundation",
    description:
      "Production-only foundation stack: Access organization, Cloudflare IdP and the account-member policy every internal surface reuses.",
    synthetic: true,
  },
  {
    stack: "AxiomStack",
    name: "Observability",
    description:
      "Production-only Axiom stack: OTel datasets (metrics/traces/logs), per-app dashboards, monitors and email alerts.",
    synthetic: true,
  },
  {
    stack: "Stripe",
    name: "Stripe",
    description: "Hosted checkout, payments and webhooks (live + sandbox accounts).",
    synthetic: true,
    external: true,
  },
];

export const actors: NodeMeta[] = [
  {
    key: "actor/Visitor",
    name: "Visitor",
    description:
      "Anyone on the public internet: browses the site, buys, signs up, follows artifact links, sends email.",
    technology: "Person",
    role: "person",
  },
  {
    key: "actor/Operator",
    name: "Operator",
    description:
      "Staff — a Cloudflare account member. Reaches internal consoles through Zero Trust Access.",
    technology: "Person",
    role: "person",
  },
  {
    key: "actor/Agent",
    name: "AI Agent",
    description:
      "MCP clients (Claude et al.): build artifacts via Mezedes, read and draft mail via Inbox tools.",
    technology: "Person (non-human)",
    role: "person",
  },
];

/** Per-resource intent, keyed by "Stack/FQN". */
export const nodes: NodeMeta[] = [
  // ── Identity ────────────────────────────────────────────────────────────
  {
    key: "SomewhatIntelligentAuth/SomewhatIntelligentAuthApp",
    name: "Identity App",
    description: "Account/dashboard UI (TanStack Start). The only public door into auth.",
    technology: "Cloudflare Worker · TanStack Start",
    role: "compute",
    domain: "accounts.somewhatintelligent.ca",
    serviceName: "auth-app",
  },
  {
    key: "SomewhatIntelligentAuth/AuthWorker",
    name: "Auth API",
    description:
      "better-auth backend. No public URL — reachable only over the AUTH service binding.",
    technology: "Cloudflare Worker · better-auth",
    role: "compute",
    serviceName: "auth",
  },
  {
    key: "SomewhatIntelligentAuth/AuthDatabase",
    name: "Auth DB",
    description:
      "Accounts, sessions, orgs, passkeys. Production adopts the pre-existing guestlist DB behind an id guard.",
    technology: "Cloudflare D1 (SQLite)",
    role: "datastore",
  },
  {
    key: "SomewhatIntelligentAuth/AuthAvatars",
    name: "Avatars",
    description: "Profile images.",
    technology: "Cloudflare R2",
    role: "datastore",
  },
  {
    key: "SomewhatIntelligentAuth/AuthMigrations",
    name: "Auth Schema",
    description: "Drizzle schema + generated migrations applied to the Auth DB at deploy.",
    technology: "Drizzle (build-time)",
    role: "schema",
  },
  // ── Site & Commerce ─────────────────────────────────────────────────────
  {
    key: "PlatformCommerce/Site",
    name: "Storefront",
    description:
      "Public website + shop at the apex: catalog, cart, orders, writing, software, about. Stateless by design.",
    technology: "Cloudflare Worker · Astro",
    role: "compute",
    domain: "somewhatintelligent.ca",
  },
  {
    key: "PlatformCommerce/Commerce",
    name: "Commerce Core",
    description:
      "~32-method RPC domain surface: catalog, checkout, orders, fulfilment, deletion, audit. The service binding IS the auth boundary — no public URL.",
    technology: "Cloudflare Worker · Effect RPC",
    role: "compute",
  },
  {
    key: "PlatformCommerce/Settlement",
    name: "Settlement",
    description:
      "Stripe webhook intake (HMAC-verified) → payment-events queue → idempotent settle; 15-min reconcile cron.",
    technology: "Cloudflare Worker · cron + queue consumer",
    role: "compute",
    domain: "hooks.somewhatintelligent.ca",
    serviceName: "commerce-settlement",
  },
  {
    key: "PlatformCommerce/Media",
    name: "Media",
    description: "Read-only GET /media/:id — streams R2 objects through a D1 active-product join.",
    technology: "Cloudflare Worker",
    role: "compute",
    serviceName: "commerce-media",
  },
  {
    key: "PlatformCommerce/CommerceOperator",
    name: "Operator Console",
    description: "Staff console for catalog and orders. Verifies the Access JWT on every request.",
    technology: "Cloudflare Worker · TanStack Start",
    role: "compute",
    domain: "commerce.somewhatintelligent.ca",
    serviceName: "commerce-operator",
  },
  {
    key: "PlatformCommerce/CommerceDatabase",
    name: "Commerce DB",
    description:
      "One D1 shared by all commerce workers: 11 domain tables — catalog, orders, reservations, payment events, audit ledger.",
    technology: "Cloudflare D1 (SQLite)",
    role: "datastore",
  },
  {
    key: "PlatformCommerce/CommerceMedia",
    name: "Media Store",
    description: "Product media objects.",
    technology: "Cloudflare R2",
    role: "datastore",
  },
  {
    key: "PlatformCommerce/CommercePaymentEvents",
    name: "Payment Events",
    description:
      "Queue between webhook intake and settlement, keyed idempotent by provider event id.",
    technology: "Cloudflare Queue",
    role: "datastore",
  },
  {
    key: "PlatformCommerce/Settlement/CommercePaymentEventsConsumer",
    name: "Queue Consumer",
    description: "Wires Settlement as the payment-events consumer (maxRetries 5).",
    technology: "Cloudflare Queue Consumer",
    role: "edge",
  },
  {
    key: "PlatformCommerce/CommerceSchema",
    name: "Commerce Schema",
    description: "Drizzle schema + migrations applied to the Commerce DB at deploy.",
    technology: "Drizzle (build-time)",
    role: "schema",
  },
  {
    key: "PlatformCommerce/OperatorAccess",
    name: "Operator Access",
    description:
      "Zero Trust Access application in front of the operator console; account members only.",
    technology: "Cloudflare Access",
    role: "edge",
  },
  {
    key: "PlatformCommerce/StripeListener",
    name: "Stripe Listener",
    description: "Local `stripe listen` forwarder, armed only under alchemy dev — not deployed.",
    technology: "Stripe CLI (dev only)",
    role: "dev",
  },
  // ── Inbox ───────────────────────────────────────────────────────────────
  {
    key: "AgenticInbox/Inbox",
    name: "Inbox App",
    description:
      "Mailbox UI + Hono API + EmailAgent (Agents SDK) + MCP surface at /mcp. One SQLite Durable Object per mailbox; inbound mail via Email Routing catch-all.",
    technology: "Cloudflare Worker · React Router + DOs",
    role: "compute",
    domain: "mail.somewhatintelligent.ca",
    serviceName: "inbox",
  },
  {
    key: "AgenticInbox/Bucket",
    name: "Attachments",
    description: "Mail attachment storage.",
    technology: "Cloudflare R2",
    role: "datastore",
  },
  {
    key: "AgenticInbox/Ai",
    name: "AI Gateway",
    description: "Gateway in front of Workers AI for the mail agent's inference.",
    technology: "Cloudflare AI Gateway",
    role: "datastore",
  },
  {
    key: "AgenticInbox/InboxAccess",
    name: "Inbox Access",
    description: "Zero Trust Access application in front of the mailbox.",
    technology: "Cloudflare Access",
    role: "edge",
  },
  // ── Mezedes ─────────────────────────────────────────────────────────────
  {
    key: "Mezedes/Mezedes",
    name: "Mezedes",
    description:
      "MCP `create` → install, typecheck, bundle, publish. Owner shell behind Access; artifacts served publicly on the wildcard zone via WorkerLoader.",
    technology: "Cloudflare Worker · WorkerLoader + DO",
    role: "compute",
    domain: "mezedes.somewhatintelligent.ca + *.somewhatintelligent.dev",
  },
  {
    key: "Mezedes/Blobs",
    name: "Artifact Blobs",
    description: "Published artifact bundles.",
    technology: "Cloudflare R2",
    role: "datastore",
  },
  {
    key: "Mezedes/MezedesAccess",
    name: "Shell Access",
    description: "Zero Trust Access on the owner shell only — artifact links stay shareable.",
    technology: "Cloudflare Access",
    role: "edge",
  },
  // ── Synthetic (production-guarded foundation, drawn from infra/) ────────
  {
    key: "Cloudflare/__stack__@production",
    name: "Zero Trust Foundation",
    description:
      "Access organization, Cloudflare IdP, account-member policy. Every internal Access app references this stack's production output.",
    technology: "Cloudflare Zero Trust",
    role: "edge",
  },
  {
    key: "SomewhatIntelligentAuth/__stack__",
    name: "Identity (stack output)",
    description:
      "AuthRouting contract consumed by the storefront: origin, auth base URL, cookie domain, feature manifest.",
    technology: "alchemy cross-stack output",
    role: "edge",
  },
  {
    key: "AxiomStack/__stack__@production",
    name: "Observability",
    description:
      "production-metrics / traces / logs datasets + ingest token, resolved lazily by every prod/staging worker.",
    technology: "Axiom (OTel)",
    role: "external",
  },
  {
    key: "Stripe/__external__",
    name: "Stripe",
    description: "Hosted checkout + webhook source for settlement.",
    technology: "SaaS",
    role: "external",
  },
];

/**
 * Runtime relationships that exist in code paths, not resource props.
 * Every entry cites the file that implements it.
 */
export const assertedEdges: AssertedEdge[] = [
  // People
  {
    from: "actor/Visitor",
    to: "PlatformCommerce/Site",
    label: "browses, shops",
    technology: "HTTPS",
    evidence: "apps/platform.site/src/pages/",
  },
  {
    from: "actor/Visitor",
    to: "SomewhatIntelligentAuth/SomewhatIntelligentAuthApp",
    label: "signs up, manages account",
    technology: "HTTPS",
    evidence: "apps/platform.auth/alchemy.run.ts",
  },
  {
    from: "actor/Visitor",
    to: "Mezedes/Mezedes",
    label: "opens artifact links",
    technology: "HTTPS *.somewhatintelligent.dev",
    evidence: "apps/mezedes/alchemy.run.ts",
  },
  {
    from: "actor/Visitor",
    to: "AgenticInbox/Inbox",
    label: "sends mail (catch-all)",
    technology: "SMTP → Email Routing",
    evidence: "apps/platform.inbox/workers/",
  },
  {
    from: "actor/Operator",
    to: "PlatformCommerce/CommerceOperator",
    label: "manages catalog & orders",
    technology: "HTTPS via Access",
    evidence: "apps/platform.commerce/module.ts",
  },
  {
    from: "actor/Operator",
    to: "AgenticInbox/Inbox",
    label: "reads mail",
    technology: "HTTPS via Access",
    evidence: "apps/platform.inbox/alchemy.run.ts",
  },
  {
    from: "actor/Operator",
    to: "Mezedes/Mezedes",
    label: "uses owner shell",
    technology: "HTTPS via Access",
    evidence: "apps/mezedes/alchemy.run.ts",
  },
  {
    from: "actor/Agent",
    to: "Mezedes/Mezedes",
    label: "create artifacts",
    technology: "MCP /mcp",
    evidence: "apps/mezedes/README",
  },
  {
    from: "actor/Agent",
    to: "AgenticInbox/Inbox",
    label: "read/search/draft mail",
    technology: "MCP /mcp",
    evidence: "apps/platform.inbox/alchemy.run.ts",
  },
  // Payments loop
  {
    from: "PlatformCommerce/Commerce",
    to: "Stripe/__external__",
    label: "mints checkout sessions",
    technology: "Stripe API",
    evidence: "apps/platform.commerce/services/PaymentsStripe.ts",
  },
  {
    from: "Stripe/__external__",
    to: "PlatformCommerce/Settlement",
    label: "checkout/charge/dispute events",
    technology: "signed webhook POST /webhook",
    evidence: "apps/platform.commerce/infrastructure/StripeDev.ts",
  },
  {
    from: "PlatformCommerce/Settlement",
    to: "Stripe/__external__",
    label: "verifies & reconciles",
    technology: "Stripe API",
    evidence: "apps/platform.commerce/workers/SettlementSurface.ts",
  },
  // Cross-system runtime
  {
    from: "PlatformCommerce/Site",
    to: "SomewhatIntelligentAuth/SomewhatIntelligentAuthApp",
    label: "account links",
    technology: "HTTPS redirect (AUTH_ORIGIN)",
    evidence: "apps/platform.site/src/components/SiteHeader.astro",
  },
  // Telemetry (prod/staging tiers only)
  {
    from: "SomewhatIntelligentAuth/AuthWorker",
    to: "AxiomStack/__stack__@production",
    label: "OTLP export",
    technology: "OTel",
    evidence: "infra/telemetry.ts",
  },
  {
    from: "SomewhatIntelligentAuth/SomewhatIntelligentAuthApp",
    to: "AxiomStack/__stack__@production",
    label: "OTLP export",
    technology: "OTel",
    evidence: "infra/telemetry.ts",
  },
  {
    from: "PlatformCommerce/Settlement",
    to: "AxiomStack/__stack__@production",
    label: "OTLP export",
    technology: "OTel",
    evidence: "infra/telemetry.ts",
  },
  {
    from: "PlatformCommerce/CommerceOperator",
    to: "AxiomStack/__stack__@production",
    label: "OTLP export",
    technology: "OTel",
    evidence: "infra/telemetry.ts",
  },
  {
    from: "AgenticInbox/Inbox",
    to: "AxiomStack/__stack__@production",
    label: "OTLP export",
    technology: "OTel",
    evidence: "infra/telemetry.ts",
  },
];

/**
 * Hand-authored component teaser for the Commerce Core worker — the
 * hexagonal interior the IaC graph cannot see. Extracting THIS mechanically
 * (from Effect service tags and Layer composition) is the next milestone.
 */
export const commerceComponents: {
  of: string;
  components: ComponentMeta[];
  wiring: { from: string; to: string; label: string }[];
} = {
  of: "PlatformCommerce/Commerce",
  components: [
    { name: "Catalog", description: "Product lifecycle", kind: "domain" },
    { name: "Checkout", description: "Session mint + reservation", kind: "domain" },
    { name: "Orders", description: "Order queries & fulfilment", kind: "domain" },
    {
      name: "Settlement",
      description: "Idempotent settle (shared with Settlement worker)",
      kind: "domain",
    },
    { name: "Audit", description: "Append-only ledger", kind: "domain" },
    { name: "Database (port)", description: "Effect service tag over D1", kind: "port" },
    { name: "Blobs (port)", description: "Effect service tag over R2", kind: "port" },
    { name: "Payments (port)", description: "Provider-agnostic payments", kind: "port" },
    {
      name: "PaymentsStripe",
      description: "Live adapter (only one in deploy graph)",
      kind: "adapter",
    },
    { name: "CommerceSurface", description: "RPC composition root", kind: "surface" },
  ],
  wiring: [
    { from: "CommerceSurface", to: "Catalog", label: "routes RPC" },
    { from: "CommerceSurface", to: "Checkout", label: "routes RPC" },
    { from: "CommerceSurface", to: "Orders", label: "routes RPC" },
    { from: "CommerceSurface", to: "Audit", label: "routes RPC" },
    { from: "Catalog", to: "Database (port)", label: "reads/writes" },
    { from: "Checkout", to: "Database (port)", label: "reserves" },
    { from: "Checkout", to: "Payments (port)", label: "mints session" },
    { from: "Orders", to: "Database (port)", label: "reads" },
    { from: "Settlement", to: "Database (port)", label: "settles" },
    { from: "Audit", to: "Database (port)", label: "appends" },
    { from: "Payments (port)", to: "PaymentsStripe", label: "provided by" },
    { from: "Catalog", to: "Blobs (port)", label: "media" },
  ],
};
