import type { ComponentType, ReactNode } from "react";

export type AnalyticsEventMap<E = unknown> = { [K in keyof E]: object };

export type CaptureFn<Events extends AnalyticsEventMap<Events>> = <E extends keyof Events>(
  event: E,
  props: Events[E],
) => void;

export type CaptureAsyncFn<Events extends AnalyticsEventMap<Events>> = <E extends keyof Events>(
  event: E,
  props: Events[E],
) => Promise<void>;

export interface AnalyticsProviderProps<S> {
  app: string;
  environment: string | undefined;
  session: S | null;
  children?: ReactNode;
}

export interface AnalyticsAdapter<Events extends AnalyticsEventMap<Events>, S = unknown> {
  Provider?: ComponentType<AnalyticsProviderProps<S>>;
  useCapture?: () => CaptureFn<Events>;
  useCaptureAsync?: () => CaptureAsyncFn<Events>;
}

export interface AnalyticsSurface<Events extends AnalyticsEventMap<Events>, S> {
  AnalyticsProvider: ComponentType<AnalyticsProviderProps<S>>;
  useCapture: () => CaptureFn<Events>;
  useCaptureAsync: () => CaptureAsyncFn<Events>;
}

export function createAnalytics<Events extends AnalyticsEventMap<Events>, S = unknown>(
  adapter?: AnalyticsAdapter<Events, S>,
): AnalyticsSurface<Events, S> {
  const noopCapture: CaptureFn<Events> = () => {};

  const AnalyticsProvider: ComponentType<AnalyticsProviderProps<S>> = adapter?.Provider
    ? adapter.Provider
    : ({ children }: AnalyticsProviderProps<S>) => children;

  const useCapture = adapter?.useCapture ?? (() => noopCapture);

  const useCaptureAsync: () => CaptureAsyncFn<Events> =
    adapter?.useCaptureAsync ??
    (adapter?.useCapture
      ? () => {
          const capture = adapter.useCapture!();
          return async (event, props) => capture(event, props);
        }
      : () => async () => {});

  return { AnalyticsProvider, useCapture, useCaptureAsync };
}
