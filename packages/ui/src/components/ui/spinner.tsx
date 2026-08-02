"use client";

import { cn } from "@si/ui/lib/utils";

const sizeMap = {
  xs: "h-3 w-6",
  sm: "h-4 w-8",
  md: "h-5 w-10",
  lg: "h-6 w-12",
} as const;

type SpinnerSize = keyof typeof sizeMap;

function Spinner({
  className,
  size = "sm",
  ...props
}: React.ComponentProps<"div"> & { size?: SpinnerSize }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "relative inline-flex items-center justify-center rounded-sm",
        sizeMap[size],
        className,
      )}
      {...props}
    >
      <span className="absolute inset-0 animate-pulse rounded-sm bg-current opacity-30" />
      <span className="absolute inset-y-0.5 inset-x-1 animate-pulse rounded-sm bg-current opacity-60 [animation-delay:150ms]" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export { Spinner };
export type { SpinnerSize };
