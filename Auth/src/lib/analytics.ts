import adapter from "@/analytics.adapter";
import { createAnalytics } from "@/lib/analytics-surface";
import type { ClientEventProps } from "@/lib/analytics-events";
import type { IdentitySession } from "@/lib/session";

export type { ClientEvent, ClientEventProps } from "@/lib/analytics-events";
export type { IdentityAnalyticsAdapter } from "@/analytics.adapter";

export const { AnalyticsProvider, useCapture, useCaptureAsync } = createAnalytics<
  ClientEventProps,
  IdentitySession
>(adapter);
