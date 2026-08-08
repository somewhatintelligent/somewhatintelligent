/**
 * One dashboard per app, built from the trace schema rather than guessed at.
 *
 * Every panel below was written against a real query run on `production-traces`
 * — the field names here (`attributes.http.response.status_code`,
 * `status.code`, `duration` in NANOSECONDS) are what Axiom's OTel mapping
 * actually produces, not what the OTel spec suggests it might.
 *
 * `service.name` is compared literally, with no unquoting step. It briefly
 * needed one: names set through alchemy's Layer were packed with
 * `packEnvValue` and arrived wearing double quotes. That is fixed at the source
 * — every Worker now names itself with a plain env var — so these queries say
 * what they mean. Spans ingested before the fix carry the quoted name and will
 * not match; that is a few hours of test traffic and it ages out.
 */
import type { Chart, DashboardProps, LayoutCell } from "alchemy/Axiom";

const TRACES = `['production-traces']`;

const scoped = (services: readonly string[]) =>
  `${TRACES}\n| extend svc = tostring(['service.name'])\n| where svc in (${services.map((s) => `'${s}'`).join(", ")})`;

/**
 * An entry point, not an internal step. Every request produces one `server`
 * span and any number of `internal` ones, so rate and error panels that forget
 * this count the same request several times and read high by a factor nobody
 * can explain later.
 */
const ENTRY = `where kind == 'server'`;

/** Nanoseconds is the stored unit; every latency panel reports milliseconds. */
const MS = `1000000`;

export interface AppDashboard {
  /** Logical id — the alchemy state key, so it must never change casually. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly services: readonly string[];
  /** Panels specific to what this app is FOR, rather than how fast it is. */
  readonly business: readonly Chart[];
}

const statistic = (id: string, name: string, apl: string): Chart => ({
  id,
  name,
  type: "Statistic",
  query: { apl },
});

const timeSeries = (id: string, name: string, apl: string): Chart => ({
  id,
  name,
  type: "TimeSeries",
  query: { apl },
});

const table = (id: string, name: string, apl: string): Chart => ({
  id,
  name,
  type: "Table",
  query: { apl },
});

/**
 * Pack charts left-to-right on Axiom's 12-column grid, wrapping when a row is
 * full. Hand-written `x`/`y` for six panels per dashboard is how a layout ends
 * up with two charts silently stacked on the same cell.
 */
const layout = (cells: readonly (readonly [Chart, number, number])[]): LayoutCell[] => {
  const out: LayoutCell[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const [chart, w, h] of cells) {
    if (x + w > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    out.push({ i: chart.id, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return out;
};

/**
 * The panels every app gets: throughput, failure, latency, and where the time
 * goes. Business panels are appended per app, because "is it healthy" and "is
 * it doing anything useful" are different questions and only the first one
 * generalises.
 */
const technical = (app: AppDashboard): Chart[] => {
  const base = scoped(app.services);
  return [
    statistic("requests", "Requests", `${base}\n| ${ENTRY}\n| summarize count()`),
    statistic(
      "error-rate",
      "Error rate %",
      `${base}\n| ${ENTRY}\n| summarize errors = countif(['status.code'] == 'ERROR' or toint(['attributes.http.response.status_code']) >= 500), total = count()\n| extend pct = round(todouble(errors) * 100 / todouble(total), 2)\n| project pct`,
    ),
    statistic(
      "p95",
      "p95 latency (ms)",
      `${base}\n| ${ENTRY}\n| summarize p95 = round(percentile(duration, 95) / ${MS}, 1)`,
    ),
    timeSeries(
      "rate-by-route",
      "Requests by route",
      `${base}\n| ${ENTRY}\n| summarize count() by bin_auto(_time), tostring(['attributes.http.route'])`,
    ),
    timeSeries(
      "latency-percentiles",
      "Latency p50 / p95 / p99 (ms)",
      `${base}\n| ${ENTRY}\n| summarize p50 = percentile(duration, 50) / ${MS}, p95 = percentile(duration, 95) / ${MS}, p99 = percentile(duration, 99) / ${MS} by bin_auto(_time)`,
    ),
    timeSeries(
      "status-classes",
      "Responses by status class",
      `${base}\n| ${ENTRY}\n| extend code = toint(['attributes.http.response.status_code'])\n| extend class = case(code < 300, '2xx', code < 400, '3xx', code < 500, '4xx', '5xx')\n| summarize count() by bin_auto(_time), class`,
    ),
    table(
      "slowest",
      "Slowest operations",
      `${base}\n| summarize calls = count(), p95_ms = round(percentile(duration, 95) / ${MS}, 1), max_ms = round(max(duration) / ${MS}, 1) by svc, name\n| order by p95_ms desc\n| limit 20`,
    ),
    table(
      "errors",
      "Recent errors",
      `${base}\n| where ['status.code'] == 'ERROR' or toint(['attributes.http.response.status_code']) >= 500\n| project _time, svc, name, ['attributes.http.route'], ['attributes.http.response.status_code'], ['status.code'], trace_id\n| order by _time desc\n| limit 50`,
    ),
  ];
};

/**
 * Build the full Axiom dashboard document for one app.
 *
 * `owner: ''` is required, not stylistic — Axiom rejects a per-user owner when
 * the caller authenticates with an API token, and rewrites this to the
 * org-shared value. Relative windows must use the `qr-now-*` form; a plain
 * `now-24h` is refused outright.
 *
 * The return type is pinned to what `Axiom.Dashboard` accepts so a drift in
 * either direction is a compile error here rather than a rejected write.
 */
export const dashboardDocument = (app: AppDashboard): DashboardProps["dashboard"] => {
  const charts = [...technical(app), ...app.business];
  const sized = charts.map((chart): readonly [Chart, number, number] =>
    chart.type === "Statistic" ? [chart, 4, 3] : [chart, 6, 6],
  );
  return {
    name: app.title,
    owner: "",
    description: app.description,
    /**
     * The one cast, and only because alchemy beta 68 stopped narrowing
     * `DashboardProps` to its own {@link Chart} / {@link LayoutCell} — those
     * declare their nested arrays `readonly` (`SmartFilterChart.filters`),
     * while the generated Axiom schema types them mutable, and `readonly T[]`
     * does not flow into `T[]`. A compile-time variance difference only: the
     * JSON these produce is byte-identical, and nothing downstream mutates
     * them. Authoring stays on alchemy's union, which is the narrower and
     * better-documented of the two.
     */
    charts: charts as DashboardProps["dashboard"]["charts"],
    layout: layout(sized),
    refreshTime: 60 as const,
    schemaVersion: 2 as const,
    timeWindowStart: "qr-now-24h",
    timeWindowEnd: "qr-now",
  };
};

/**
 * Server functions ARE the console's business operations — creating a product,
 * refunding an order — so `serverFn <name>` is the business panel.
 *
 * It reads a NAMING CONVENTION and nothing more: spans whose name starts with
 * `serverFn ` carry the operation in the remainder. Whatever opens them has to
 * know which one it is handling; from the Worker boundary these are all one
 * indistinguishable POST, so a span named only by method and path cannot
 * populate this panel.
 */
const operatorServerFunctions = (services: readonly string[]): Chart[] => [
  timeSeries(
    "server-fns",
    "Console operations",
    `${scoped(services)}\n| where name startswith 'serverFn '\n| summarize count() by bin_auto(_time), name`,
  ),
  table(
    "server-fn-latency",
    "Console operations — latency",
    `${scoped(services)}\n| where name startswith 'serverFn '\n| summarize calls = count(), p95_ms = round(percentile(duration, 95) / ${MS}, 1) by name\n| order by calls desc\n| limit 20`,
  ),
];

export const APPS: readonly AppDashboard[] = [
  {
    id: "AuthDashboard",
    title: "Auth",
    description: "Identity: the better-auth API worker and the account UI in front of it.",
    services: ["auth", "auth-app"],
    business: [
      timeSeries(
        "auth-operations",
        "Auth operations",
        `${scoped(["auth", "auth-app"])}\n| where tostring(['attributes.url.path']) startswith '/api/auth/'\n| summarize count() by bin_auto(_time), tostring(['attributes.url.path'])`,
      ),
      timeSeries(
        "auth-rejections",
        "Rejected auth attempts (4xx)",
        `${scoped(["auth", "auth-app"])}\n| extend code = toint(['attributes.http.response.status_code'])\n| where code >= 400 and code < 500\n| summarize count() by bin_auto(_time), code`,
      ),
    ],
  },
  {
    id: "CommerceDashboard",
    title: "Commerce",
    description:
      "The order book and catalogue, the settlement webhook, media, and the operator console.",
    services: ["commerce", "commerce-settlement", "commerce-media", "commerce-operator"],
    business: [
      timeSeries(
        "catalogue-and-orders",
        "Catalogue & order operations",
        `${scoped(["commerce"])}\n| where name startswith 'Orders.' or name startswith 'Catalog.' or name startswith 'Storefront.'\n| summarize count() by bin_auto(_time), name`,
      ),
      timeSeries(
        "settlement",
        "Settlement activity",
        `${scoped(["commerce-settlement"])}\n| summarize count() by bin_auto(_time), name`,
      ),
      /**
       * DELIBERATELY ABSENT: a panel over
       * `attributes.custom.commerce.settlement.outcome`.
       *
       * `Settlement.settle` now annotates its span with that outcome — the one
       * field separating "we took payment and recorded it" from "we silently
       * ignored a live event" — and it is queryable ad hoc today. But Axiom
       * rejects a query naming a field it has never ingested, so the panel
       * cannot be declared until the first payment settles in production. Add
       * it then; the shape is:
       *
       *   | summarize count() by bin_auto(_time),
       *       tostring(['attributes.custom.commerce.settlement.outcome'])
       *
       * The `SettlementFailure` monitor does not have this problem: it keys on
       * `status.code`, which every span carries.
       */
      ...operatorServerFunctions(["commerce-operator"]),
    ],
  },
  /**
   * Mezedes and the inbox sit behind Access, so their panels stay empty until a
   * signed-in person actually uses them — the edge rejects everything else
   * before the Worker runs. Their business panels are keyed on route rather
   * than on span names: there is no traffic yet to learn the span names from,
   * and a panel querying a name that turns out not to exist is worse than one
   * that is merely coarse.
   */
  {
    id: "MezedesDashboard",
    title: "Mezedes",
    description: "The artifact shell, its API, and the MCP surface.",
    services: ["mezedes"],
    business: [
      timeSeries(
        "mezedes-surfaces",
        "Traffic by surface",
        `${scoped(["mezedes"])}\n| ${ENTRY}\n| extend path = tostring(['attributes.url.path'])\n| extend surface = case(path startswith '/mcp', 'mcp', path startswith '/api/', 'api', 'shell')\n| summarize count() by bin_auto(_time), surface`,
      ),
    ],
  },
  {
    id: "InboxDashboard",
    title: "Inbox",
    description: "Agentic mail: the HTTP surface. Inbound mail delivery is not traced yet.",
    services: ["inbox"],
    business: [
      timeSeries(
        "inbox-routes",
        "Traffic by route",
        `${scoped(["inbox"])}\n| ${ENTRY}\n| summarize count() by bin_auto(_time), tostring(['attributes.http.route'])`,
      ),
    ],
  },
];
