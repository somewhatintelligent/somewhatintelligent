/**
 * The alerts. Deliberately few.
 *
 * A monitor that fires on something nobody acts on trains you to ignore the
 * channel, and then the one that matters arrives in a muted inbox. Each of
 * these names a condition worth interrupting someone for, and the thresholds
 * are set for a platform with single-digit users — they will need raising the
 * moment real traffic arrives, which is the honest trade for catching anything
 * at all at this size.
 *
 * NOT INCLUDED, on purpose: a no-data / dead-service monitor. At current volume
 * an hour with zero requests is an ordinary night, not an outage, so it would
 * fire constantly and mean nothing. It becomes worth adding once a baseline
 * exists to deviate from.
 */
import type { MonitorProps } from "alchemy/Axiom";

const TRACES = `['production-traces']`;

/** Compared literally — see the note on service naming in `dashboards.ts`. */
const NORMALISE = `extend svc = tostring(['service.name'])`;

const FAILED = `where ['status.code'] == 'ERROR' or toint(['attributes.http.response.status_code']) >= 500`;

export interface MonitorSpec {
  /** Logical id — the alchemy state key. */
  readonly id: string;
  readonly props: (notifierIds: readonly string[]) => MonitorProps;
}

export const MONITORS: readonly MonitorSpec[] = [
  {
    id: "ErrorRate",
    props: (notifierIds) => ({
      name: "Platform errors",
      description:
        "Any Worker returning 5xx or recording a failed span. Scoped to entry spans so one failed request counts once.",
      type: "Threshold",
      aplQuery: `${TRACES}\n| ${NORMALISE}\n| where kind == 'server'\n| ${FAILED}\n| summarize count() by bin_auto(_time)`,
      operator: "Above",
      threshold: 5,
      intervalMinutes: 5,
      rangeMinutes: 5,
      alertOnNoData: false,
      resolvable: true,
      notifierIds: [...notifierIds],
    }),
  },
  {
    id: "LatencyRegression",
    props: (notifierIds) => ({
      name: "Latency regression",
      description:
        "p95 above 3s over ten minutes. Nanoseconds are the stored unit, hence the divisor.",
      type: "Threshold",
      aplQuery: `${TRACES}\n| ${NORMALISE}\n| where kind == 'server'\n| summarize p95 = percentile(duration, 95) / 1000000 by bin_auto(_time)`,
      operator: "Above",
      threshold: 3000,
      intervalMinutes: 10,
      rangeMinutes: 10,
      alertOnNoData: false,
      resolvable: true,
      notifierIds: [...notifierIds],
    }),
  },
  {
    id: "AuthRejectionBurst",
    props: (notifierIds) => ({
      name: "Auth rejection burst",
      description:
        "A spike of 401/403/429 against identity — the shape credential stuffing makes. A handful is someone mistyping a password; twenty-five in five minutes is not.",
      type: "Threshold",
      aplQuery: `${TRACES}\n| ${NORMALISE}\n| where svc in ('auth', 'auth-app')\n| extend code = toint(['attributes.http.response.status_code'])\n| where code == 401 or code == 403 or code == 429\n| summarize count() by bin_auto(_time)`,
      operator: "Above",
      threshold: 25,
      intervalMinutes: 5,
      rangeMinutes: 5,
      alertOnNoData: false,
      resolvable: true,
      notifierIds: [...notifierIds],
    }),
  },
  {
    id: "SettlementFailure",
    props: (notifierIds) => ({
      name: "Settlement failure",
      description:
        "Every failed span in the settlement worker, individually. This one is MatchEvent rather than a threshold because a single payment that took money and never marked an order paid is already worth waking up for.",
      type: "MatchEvent",
      aplQuery: `${TRACES}\n| ${NORMALISE}\n| where svc == 'commerce-settlement'\n| ${FAILED}`,
      intervalMinutes: 5,
      rangeMinutes: 5,
      alertOnNoData: false,
      notifierIds: [...notifierIds],
    }),
  },
];
