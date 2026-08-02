import adapter from "@/analytics.adapter";
import { createAnalytics } from "@/lib/analytics-surface";
import type { ClientEventProps } from "@/lib/analytics-events";
import type { IdentitySession } from "@/lib/session";

export const { AnalyticsProvider, useCapture } = createAnalytics<ClientEventProps, IdentitySession>(
  adapter,
);
