import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { AnalyticsProvider } from "@/lib/analytics";
import { appConfig } from "@/app.config";
import type { RouterContext } from "@/router";
import { AppError, AppNotFound } from "@/components/app-status-pages";
import { loadSession } from "@/lib/session.functions";
import { appVersion } from "@/lib/version";

const SITE_TITLE = `Identity — ${appConfig.brand.name}`;
const SITE_DESCRIPTION = `Sign in, manage your account, and control access across ${appConfig.brand.name}'s platform.`;
/** What a screen reader announces for the card, and what a cropped card leaves behind. */
const CARD_ALT = `${appConfig.brand.name} — account`;

import appCss from "@/styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const [session, version] = await Promise.all([loadSession(), appVersion()]);
    return { session, version };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      {
        name: "description",
        content: SITE_DESCRIPTION,
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: SITE_TITLE },
      {
        property: "og:description",
        content: SITE_DESCRIPTION,
      },
      { property: "og:site_name", content: appConfig.brand.name },
      /**
       * ROOT-RELATIVE, AND THAT IS A KNOWN LIMIT. Facebook and X both require an
       * absolute `og:image`; this app has no request origin available inside a
       * router `head()`, and threading one through `beforeLoad` for a set of
       * pages nobody shares is not worth the plumbing. The STOREFRONT, which is
       * what actually gets shared, emits absolute URLs — see
       * `apps/platform.site/src/layouts/Base.astro`. Fix here by publishing the
       * app's own origin as a var if a sign-in link ever needs to unfurl.
       */
      { property: "og:image", content: "/og/opengraph-image.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: CARD_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      {
        name: "twitter:description",
        content: SITE_DESCRIPTION,
      },
      { name: "twitter:image", content: "/og/twitter-image.png" },
      { name: "twitter:image:alt", content: CARD_ALT },
      { name: "theme-color", content: "#080908" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      /**
       * 96, matching what `og/icon.og.tsx` renders. It said `32x32` while
       * pointing at a file that did not exist at all — the OG pipeline these
       * paths were copied from had been left behind in the port.
       */
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/og/icon.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/og/apple-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { session } = Route.useRouteContext();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <AnalyticsProvider
          app="identity"
          environment={import.meta.env.ENVIRONMENT}
          session={session}
        >
          {children}
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
          <Scripts />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
