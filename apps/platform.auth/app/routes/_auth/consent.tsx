import { createFileRoute, redirect } from "@tanstack/react-router";
import { Alert } from "platform.ui/components/alert";
import { Card, CardContent } from "platform.ui/components/card";
import { scopeCopy } from "@/lib/scopes";
import { ConsentActions } from "@/components/auth/consent-actions";
import { resolveConsentingClient } from "@/lib/oauth-clients.functions";

interface ConsentSearch {
  client_id?: string;
  scope?: string;
  redirect_uri?: string;
  [key: string]: string | undefined;
}

function buildOAuthQuery(search: ConsentSearch): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") params.append(key, value);
  }
  return params.toString();
}

export const Route = createFileRoute("/_auth/consent")({
  validateSearch: (search: Record<string, unknown>): ConsentSearch => {
    const out: ConsentSearch = {};
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  },
  beforeLoad: ({ context, search }) => {
    // `to`-based (not href) so the redirect stays mount-correct on the
    // client — see routes/index.tsx.
    if (!context.session) throw redirect({ to: "/sign-in" });
    if (!search.client_id) throw redirect({ to: "/sign-in" });
  },
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => {
    const { search } = deps;
    /**
     * A FAILED LOOKUP IS `selfRegistered: true`. The warning exists to be shown
     * when we cannot vouch for a client, and "the lookup broke" is a case of
     * not being able to vouch for it. Defaulting the other way would make an
     * outage silently remove the warning.
     */
    const client = search.client_id
      ? await resolveConsentingClient({
          data: { client_id: search.client_id, oauth_query: buildOAuthQuery(search) },
        }).catch(() => ({ name: null, selfRegistered: true }))
      : { name: null, selfRegistered: true };
    return {
      client,
      scope: search.scope ?? "openid profile email",
    };
  },
  head: () => ({ meta: [{ title: "Authorize — Identity" }] }),
  component: ConsentPage,
});

function ConsentPage() {
  const { client, scope } = Route.useLoaderData();
  const { client_id } = Route.useSearch();
  const { session } = Route.useRouteContext();
  const requestedScopes = scope.split(" ");
  const user = session!.user;

  return (
    <>
      <div className="mb-section text-center">
        <div className="type-display-title">Authorize</div>
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">{client.name ?? client_id}</strong> wants access
        </div>
      </div>

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardContent className="space-y-0 p-0">
          {/*
            FIRST, above the account and the permissions.

            Anyone may register a client here, and `client.name` is a string
            they chose — so the line above this card can read "somewhatintelligent"
            no matter who is asking. This is the only thing on the screen that
            they did not choose, and it is worth nothing at the bottom.
          */}
          {client.selfRegistered && (
            <Alert variant="destructive" className="mb-8">
              <div className="font-medium">Nobody has vouched for this app</div>
              <div className="text-xs">
                It registered itself and picked its own name, which may imitate one you trust. Only
                continue if you started this from the app yourself.
              </div>
            </Alert>
          )}
          <div className="mb-8 flex items-center gap-3 rounded-sm bg-surface-sunken px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
              {user.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div>
              <div className="text-sm font-medium">{user.name}</div>
              <div className="font-mono text-xs text-muted-foreground/80">{user.email}</div>
            </div>
          </div>

          <div className="mb-8">
            <div className="type-mono-label mb-3 text-muted-foreground/80">Permissions</div>
            <div className="flex flex-col gap-2">
              {requestedScopes.map((s) => {
                const copy = scopeCopy(s);
                return (
                  <div
                    key={s}
                    className="flex items-start gap-2.5 rounded-sm bg-surface-sunken px-4 py-3 text-sm"
                  >
                    <span className="text-success">✓</span>
                    <div>
                      {/* The raw scope when there is no copy — a client may ask
                          for one this build does not know, and showing the
                          string is honest where inventing a sentence is not. */}
                      <div>{copy?.label ?? s}</div>
                      {copy && (
                        <div className="text-xs text-muted-foreground/80">{copy.description}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <ConsentActions />

          <p className="mt-5 text-center text-xs text-muted-foreground/80">
            You can revoke this at any time. We will not ask if you are sure.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
