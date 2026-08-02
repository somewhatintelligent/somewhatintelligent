import { siGoogle, siMeta } from "simple-icons";
import { Button } from "@si/ui/components/button";
import { BrandIcon } from "@si/ui/components/brand-icon";
import { authClient } from "@/lib/auth-client";
import type { SocialProviders } from "@/lib/providers.functions";

// Microsoft and LinkedIn aren't in simple-icons (trademark). Inline the marks.
const MICROSOFT_PATH =
  "M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z";
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

type Provider = "google" | "microsoft" | "facebook" | "linkedin";

export function SocialSignInButtons({
  providers,
  callbackURL,
  disabled,
  onStart,
  onError,
}: {
  providers: SocialProviders;
  callbackURL?: string;
  disabled?: boolean;
  onStart?: () => void;
  onError?: (message: string) => void;
}) {
  const anyEnabled =
    providers.google || providers.microsoft || providers.facebook || providers.linkedin;
  if (!anyEnabled) return null;

  async function handle(provider: Provider) {
    onStart?.();
    // BA emits the final post-callback redirect verbatim in the Location
    // header, which the browser resolves against the current origin
    // (guestlist's domain after the OAuth callback). A relative path would
    // land users on guestlist.platform.example/account instead of
    // identity.platform.example/account — anchor to identity's origin.
    const target = callbackURL ?? "/account";
    const absoluteCallback = new URL(target, window.location.origin).toString();
    const result = await authClient.signIn.social({
      provider,
      callbackURL: absoluteCallback,
    });
    if (result.error) {
      onError?.(result.error.message ?? "Failed to start sign in. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.google && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-center gap-2"
          onClick={() => handle("google")}
          disabled={disabled}
        >
          <BrandIcon path={siGoogle.path} />
          Continue with Google
        </Button>
      )}
      {providers.microsoft && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-center gap-2"
          onClick={() => handle("microsoft")}
          disabled={disabled}
        >
          <BrandIcon path={MICROSOFT_PATH} />
          Continue with Microsoft
        </Button>
      )}
      {providers.facebook && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-center gap-2"
          onClick={() => handle("facebook")}
          disabled={disabled}
        >
          <BrandIcon path={siMeta.path} />
          Continue with Meta
        </Button>
      )}
      {providers.linkedin && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-center gap-2"
          onClick={() => handle("linkedin")}
          disabled={disabled}
        >
          <BrandIcon path={LINKEDIN_PATH} />
          Continue with LinkedIn
        </Button>
      )}
    </div>
  );
}
