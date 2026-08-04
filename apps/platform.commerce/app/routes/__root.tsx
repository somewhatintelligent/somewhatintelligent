import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { Boxes, LayoutDashboard, Receipt, Settings, Store } from "lucide-react";

import { Badge } from "platform.ui/components/badge";
import { Toaster } from "platform.ui/components/sonner";

import type { RouterContext } from "../router.tsx";
import { loadOperatorContext } from "../lib/context.functions.ts";
import appCss from "../styles.css?url";

/**
 * The console shell.
 *
 * `beforeLoad` resolves the actor once per navigation from the request context
 * the Worker boundary wrote — not by re-verifying the Access assertion, which
 * happened at the boundary. A `null` actor here would mean the boundary was
 * bypassed; it cannot happen through the deployed path, and the header renders
 * it as such rather than pretending someone is signed in.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => loadOperatorContext(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Commerce — Operator" },
      /** Staff-only and behind Access; there is nothing here to index. */
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  errorComponent: ({ error }) => (
    <Shell>
      <div className="rounded-md border-2 border-destructive bg-destructive/10 p-4">
        <h1 className="font-display text-lg font-semibold text-destructive">Something failed</h1>
        <pre className="mt-2 overflow-x-auto text-sm text-destructive/80">{error.message}</pre>
      </div>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">No such page.</p>
    </Shell>
  ),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

const THEME_INIT = `(function(){try{var s=localStorage.getItem('theme');var m=(s==='light'||s==='dark')?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.classList.add(m);r.style.colorScheme=m;}catch(e){}})();`;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/orders", label: "Orders", icon: Receipt },
  { to: "/storefront", label: "Storefront", icon: Store },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const { actor, paymentsEnvironment } = Route.useRouteContext();

  return (
    <div className="flex min-h-screen w-full flex-col gap-4 px-4 py-4 xl:px-6">
      <nav className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-border pb-3">
        <span className="mr-3 font-display text-sm font-bold tracking-widest uppercase">
          Commerce
        </span>
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground data-[status=active]:bg-surface-sunken data-[status=active]:font-semibold data-[status=active]:text-foreground"
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {/*
           * LIVE IS LOUD. The same buttons move real money on `prod` and do
           * not on `dev`, and the only thing that says which is this.
           *
           * `"prod"`, NOT `"live"`. `PAYMENTS_ENVIRONMENT` is bound from
           * `environmentFor(stage)`, whose whole range is `dev | preprod |
           * prod` — `"live"` is not in it, so this comparison was never true
           * and the production console wore the same quiet badge as a dev one.
           * The `live` notion does exist, but elsewhere and differently:
           * `StripeConfig` derives it from the key prefix, and that value is
           * not what reaches this binding.
           */}
          {paymentsEnvironment ? (
            <Badge
              variant={paymentsEnvironment === "prod" ? "destructive" : "outline"}
              size="sm"
              title="Which Stripe account this deployment settles against"
            >
              {paymentsEnvironment}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground" title={actor?.sub ?? undefined}>
            {actor?.email ?? "no actor — the boundary was bypassed"}
          </span>
        </div>
      </nav>

      <main className="flex min-h-0 flex-1 flex-col gap-4">{children}</main>
    </div>
  );
}
