import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Item, ItemContent, ItemTitle, ItemActions, ItemGroup } from "@si/ui/components/item";
import { authClient } from "@/lib/auth-client";
import { loadProviders, type SocialProviders } from "@/lib/providers.functions";
import { toast } from "@si/ui/components/sonner";

interface AccountInfo {
  id: string;
  providerId: string;
  accountId: string;
}

const providerLabels: Record<string, string> = {
  google: "Google",
  microsoft: "Microsoft",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  credential: "Email & Password",
};

const ALL_LINKABLE: Array<keyof SocialProviders> = ["google", "microsoft", "facebook", "linkedin"];

export const Route = createFileRoute("/_dashboard/account/providers")({
  loader: async () => ({ providers: await loadProviders() }),
  head: () => ({ meta: [{ title: "Providers — Identity" }] }),
  component: ProvidersPage,
});

function ProvidersPage() {
  const { providers } = Route.useLoaderData();
  const linkableProviders = ALL_LINKABLE.filter((p) => providers[p]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  async function fetchAccounts() {
    setLoading(true);
    const result = await authClient.listAccounts();
    if (result.data) {
      setAccounts(result.data as unknown as AccountInfo[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchAccounts();
  }, []);

  function handleUnlink(providerId: string) {
    startTransition(async () => {
      const result = await authClient.unlinkAccount({ providerId });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to unlink account");
        return;
      }
      toast.success("Account unlinked");
      await fetchAccounts();
    });
  }

  function handleLink(provider: string) {
    startTransition(async () => {
      // Anchor to identity's origin — BA emits the post-callback redirect
      // verbatim and the browser resolves it against guestlist's domain.
      const callbackURL = new URL("/account/providers", window.location.origin).toString();
      const result = await authClient.linkSocial({
        provider: provider as "google" | "microsoft" | "facebook" | "linkedin",
        callbackURL,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to link account");
      }
    });
  }

  const linkedProviderIds = accounts.map((a) => a.providerId);
  const unlinkable = accounts.length > 1;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid">
        <h1 className="type-page-title">Providers</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked Providers</CardTitle>
          <CardDescription>
            They all lead to the same place. Link or unlink as you see fit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {loading ? (
              <p className="text-sm text-muted-foreground/80">Loading{"\u2026"}</p>
            ) : (
              <>
                {accounts.length > 0 && (
                  <ItemGroup>
                    {accounts.map((account) => (
                      <Item key={account.id} variant="surface" size="sm">
                        <ItemContent>
                          <ItemTitle>
                            <span className="flex items-center gap-2">
                              {providerLabels[account.providerId] ?? account.providerId}
                              <Badge variant="success" size="sm">
                                Linked
                              </Badge>
                            </span>
                          </ItemTitle>
                        </ItemContent>
                        {account.providerId !== "credential" && unlinkable && (
                          <ItemActions>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUnlink(account.providerId)}
                              disabled={isPending}
                            >
                              Unlink
                            </Button>
                          </ItemActions>
                        )}
                      </Item>
                    ))}
                  </ItemGroup>
                )}

                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground/80">No linked providers.</p>
                )}

                {linkableProviders.some((p) => !linkedProviderIds.includes(p)) && (
                  <div>
                    <div className="type-mono-label mb-2 text-muted-foreground/80">
                      Link a provider
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {linkableProviders
                        .filter((p) => !linkedProviderIds.includes(p))
                        .map((provider) => (
                          <Button
                            key={provider}
                            variant="outline"
                            onClick={() => handleLink(provider)}
                            disabled={isPending}
                          >
                            Link {providerLabels[provider]}
                          </Button>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
