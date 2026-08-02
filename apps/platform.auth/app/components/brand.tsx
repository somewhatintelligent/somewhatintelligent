// The platform lockup (mark + wordmark), driven entirely by
// `appConfig.brand` — forks get their own wordmark by editing
// `app/app.config.ts`, no change needed here.
// Mirrors the satori-safe `<OgBrand>` (og/_brand.tsx) so the in-app and
// OG-image renders share one mark.
import { LogoIcon } from "platform.design/logo";
import { appConfig } from "@/app.config";

// Per-app product name. Each app in the workspace declares its own —
// see `app/app-brand.ts` (this is the identity app's value).
import { APP_PRODUCT_NAME } from "#/app-brand";

export function Brand({ className, size = 64 }: { className?: string; size?: number }) {
  const subtitleSize = Math.max(7, size * 0.15);
  return (
    <div className={className}>
      <div className="flex flex-col items-center" style={{ viewTransitionName: "brand" }}>
        <LogoIcon colorScheme="light" size={size} />
        <span className="mt-1 font-medium" style={{ fontSize: size * 0.28 }}>
          {appConfig.brand.name}
        </span>
        <span
          className="mt-1 font-mono uppercase tracking-[0.25em] text-muted-foreground/80"
          style={{ fontSize: `${subtitleSize}px` }}
        >
          {APP_PRODUCT_NAME} platform
        </span>
      </div>
    </div>
  );
}
