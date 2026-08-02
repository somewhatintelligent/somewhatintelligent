// Shared platform top-nav — 52px bar, surface-raised bg, 4px
// strong bottom border, Logo + wordmark left cluster with border-r
// separator.
// Consumers compose children into left/tabs/right regions. The
// component is **app-agnostic** — the list of apps in the switcher is
// a prop, not a hardcoded enum.
import * as React from "react";
import { CheckIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@si/ui/lib/utils";
import { LogoIcon } from "@si/ui/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@si/ui/components/dropdown-menu";

// ── Root ──────────────────────────────────────────────────────────

function PlatformNavRoot({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Outer div fills the iOS standalone-PWA top safe-area (under the dynamic
  // island / notch) with the matching surface color. The inner <nav> stays
  // exactly 52px so children using `h-full` (the AppSwitcher trigger, tabs)
  // don't get stretched up into the inset region — they continue to sit in
  // the same 52px band the design specifies. Horizontal insets handle the
  // notch in landscape on Pro phones.
  return (
    <div className="bg-surface-raised" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <nav
        className={cn(
          "no-scrollbar bg-surface-raised flex h-[52px] shrink-0 items-center overflow-x-auto",
          "pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]",
          className,
        )}
        style={{ borderBottom: "4px solid var(--color-border-strong)", ...style }}
      >
        {children}
      </nav>
    </div>
  );
}

// ── AppSwitcher ───────────────────────────────────────────────────
// Wordmark markup is fixed character-for-character so consumers that
// swap in from a hand-rolled top-nav see no visual shift.

export type PlatformApp = {
  id: string;
  label: string;
  href: string;
  current?: boolean;
  external?: boolean;
};

function PlatformNavAppSwitcher({
  current,
  apps,
  linkComponent,
  triggerClassName,
}: {
  current: { id: string; label: string };
  apps: PlatformApp[];
  linkComponent?: React.ElementType;
  // When set, replaces the layout classes on the trigger for non-top-nav
  // contexts (e.g. sidebar headers). Focus ring + no-underline always apply.
  triggerClassName?: string;
}) {
  const InternalLink = linkComponent ?? "a";
  const triggerLayoutClasses =
    triggerClassName ?? "flex h-full items-center gap-2.5 border-r border-border pr-3.5 mr-2.5";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Platform app switcher"
            className={cn(
              triggerLayoutClasses,
              "no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <LogoIcon colorScheme="light" size={22} />
            <b className="text-foreground font-sans text-[14px] uppercase tracking-[0.08em]">
              {current.label}
              <span className="text-primary">.</span>
            </b>
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px]">
        {apps.map((app) => {
          const isCurrent = app.current ?? app.id === current.id;
          if (isCurrent) {
            return (
              <DropdownMenuItem
                key={app.id}
                disabled
                className="type-mono-label gap-2.5 py-2 opacity-80"
              >
                <CheckIcon className="size-[13px] text-success" aria-hidden />
                {app.label}
              </DropdownMenuItem>
            );
          }
          const external = app.external ?? true;
          const anchor = external ? (
            <a href={app.href} target="_blank" rel="noopener noreferrer" />
          ) : (
            <InternalLink href={app.href} to={app.href} />
          );
          return (
            <DropdownMenuItem key={app.id} className="type-mono-label gap-2.5 py-2" render={anchor}>
              <span className="inline-block size-[13px]" aria-hidden />
              {app.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

function PlatformNavTabs({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-stretch">{children}</div>;
}

function PlatformNavTab({
  label,
  href,
  active,
  Icon,
  linkComponent,
}: {
  label: string;
  href: string;
  active: boolean;
  Icon?: LucideIcon;
  linkComponent?: React.ElementType;
}) {
  const InternalLink = linkComponent ?? "a";
  // Tab fills the nav's content area (52px total − 4px bottom border =
  // 48px). Not `h-[52px]` because the nav's overflow-x-auto promotes
  // overflow-y to auto in all browsers; any vertical overflow (even
  // 1px) produces a visible scrollbar inside the nav. Indicator sits
  // at bottom-0 → just above the 4px border, not overlapping / below.
  // Props-wise, both TSR <Link to=""> and plain <a href=""> accept
  // these — pass both and let the concrete component pick.
  return (
    <InternalLink
      to={href}
      href={href}
      className={cn(
        "group relative flex h-full items-center gap-1.5 px-[18px] text-[13px] font-semibold uppercase tracking-[0.06em] no-underline transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {label}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px]"
        style={{ background: active ? "var(--color-ink)" : "transparent" }}
      />
    </InternalLink>
  );
}

// ── Right slot ────────────────────────────────────────────────────

function PlatformNavRight({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("ml-auto flex items-center gap-3", className)}>{children}</div>;
}

// ── Export as compound ────────────────────────────────────────────

type PlatformNavComponent = typeof PlatformNavRoot & {
  AppSwitcher: typeof PlatformNavAppSwitcher;
  Tabs: typeof PlatformNavTabs;
  Tab: typeof PlatformNavTab;
  Right: typeof PlatformNavRight;
};

export const PlatformNav = PlatformNavRoot as PlatformNavComponent;
PlatformNav.AppSwitcher = PlatformNavAppSwitcher;
PlatformNav.Tabs = PlatformNavTabs;
PlatformNav.Tab = PlatformNavTab;
PlatformNav.Right = PlatformNavRight;
