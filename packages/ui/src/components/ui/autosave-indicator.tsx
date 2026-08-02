import * as React from "react";

import { cn } from "@si/ui/lib/utils";
import type { AutosaveStatus } from "@si/ui/hooks/use-autosave";

const DEFAULT_LABELS: Record<AutosaveStatus, string> = {
  idle: "",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

export interface AutosaveIndicatorProps extends React.ComponentProps<"span"> {
  status: AutosaveStatus;
  /** Override the copy shown for any status. */
  labels?: Partial<Record<AutosaveStatus, string>>;
}

/** Presentational readout for {@link useAutosave}'s status, muted with a destructive error. */
function AutosaveIndicator({ status, labels, className, ...props }: AutosaveIndicatorProps) {
  const label = labels?.[status] ?? DEFAULT_LABELS[status];
  if (!label) return null;
  return (
    <span
      data-slot="autosave-indicator"
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}

export { AutosaveIndicator };
