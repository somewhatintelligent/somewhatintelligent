import type { IdentitySession } from "@/lib/session";
import type { AnalyticsAdapter } from "@/lib/analytics-surface";
import type { ClientEventProps } from "@/lib/analytics-events";

export type IdentityAnalyticsAdapter = AnalyticsAdapter<ClientEventProps, IdentitySession>;

const adapter: IdentityAnalyticsAdapter = {};

export default adapter;
