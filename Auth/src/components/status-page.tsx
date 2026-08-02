// Shared status / error / empty-state page. Used as the fallback body
// for TanStack Router `errorComponent` + `notFoundComponent` on every
// app, plus one-off surfaces (expired / forbidden / maintenance).
//
// The component is visual-only — consumers pass their own actions
// (Back / Go home buttons with app-specific Link components) so this
// primitive stays router-agnostic.
import * as React from "react";

import { cn } from "@si/ui/lib/utils";
import { Badge } from "@si/ui/components/badge";
import { Card } from "@si/ui/components/card";

export type StatusKind = "error" | "not-found" | "expired" | "forbidden" | "maintenance";

const DEFAULT_BADGE: Record<StatusKind, string> = {
  error: "error",
  "not-found": "not found",
  expired: "expired",
  forbidden: "forbidden",
  maintenance: "maintenance",
};

export interface StatusPageProps {
  kind: StatusKind;
  // Pass a string for plain rendering, or a React node if you want an
  // italic/primary emphasis word, e.g.
  //   <>Nothing <span className="text-primary italic">here</span>.</>
  title: React.ReactNode;
  description?: React.ReactNode;
  // Extra detail below description — e.g. an error stack trace (dev-only).
  detail?: React.ReactNode;
  // Button row at the bottom. Consumers own routing, so they build their
  // own `<Button render={<Link to="/"/>}>Go home</Button>` etc.
  actions?: React.ReactNode;
  // Override the default label derived from `kind`.
  badge?: string;
  hideBadge?: boolean;
  className?: string;
}

export function StatusPage({
  kind,
  title,
  description,
  detail,
  actions,
  badge,
  hideBadge = false,
  className,
}: StatusPageProps) {
  const badgeLabel = badge ?? DEFAULT_BADGE[kind];
  const isDestructive = kind === "error" || kind === "expired";
  return (
    <div className={cn("mx-auto w-full max-w-[860px] flex-1 px-page py-page", className)}>
      <Card className="gap-4 p-10">
        {!hideBadge ? (
          <Badge
            variant="outline"
            className={cn(
              "self-start font-mono uppercase",
              isDestructive
                ? "border-destructive text-destructive"
                : "border-border-strong text-muted-foreground",
            )}
          >
            ● {badgeLabel}
          </Badge>
        ) : null}
        <h1 className="font-display text-foreground text-[clamp(40px,6vw,80px)] leading-[0.95] font-extralight tracking-tighter">
          {title}
        </h1>
        {description ? (
          <div className="font-editorial text-muted-foreground max-w-[560px] text-base leading-relaxed">
            {description}
          </div>
        ) : null}
        {detail ? (
          <pre className="bg-surface-sunken border-border text-muted-foreground/80 mt-2 max-w-full overflow-auto rounded-sm border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {detail}
          </pre>
        ) : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-3">{actions}</div> : null}
      </Card>
    </div>
  );
}
