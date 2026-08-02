import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Item, ItemContent, ItemTitle, ItemActions, ItemGroup } from "@si/ui/components/item";
import { Input } from "@si/ui/components/input";
import { Field, FieldLabel } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

interface Passkey {
  id: string;
  name: string | null;
  deviceType: string | null;
  createdAt: Date | null;
}

export const Route = createFileRoute("/_dashboard/account/passkeys")({
  head: () => ({ meta: [{ title: "Passkeys — Identity" }] }),
  component: PasskeysPage,
});

function PasskeysPage() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  async function fetchPasskeys() {
    setLoading(true);
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) {
      setError(result.error.message ?? "Failed to load passkeys.");
    } else {
      setPasskeys((result.data as Passkey[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchPasskeys();
  }, []);

  function handleAdd() {
    startTransition(async () => {
      setError(null);
      const result = await authClient.passkey.addPasskey({
        name: newName || undefined,
      });
      if (result?.error) {
        setError(result.error.message ?? "Failed to register passkey.");
        return;
      }
      setNewName("");
      await fetchPasskeys();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      setError(null);
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setError(result.error.message ?? "Failed to delete passkey.");
        return;
      }
      await fetchPasskeys();
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid">
        <h1 className="type-page-title">Passkeys</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Passkeys</CardTitle>
          <CardDescription>
            Passwordless authentication via biometrics or security keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {loading && <p className="text-sm text-muted-foreground/80">Loading{"\u2026"}</p>}

            {!loading && passkeys.length === 0 && (
              <p className="text-sm text-muted-foreground/80">No passkeys registered.</p>
            )}

            {passkeys.length > 0 && (
              <ItemGroup>
                {passkeys.map((pk) => (
                  <Item key={pk.id} variant="surface" size="sm">
                    <ItemContent>
                      <ItemTitle>
                        <span className="flex items-center gap-2">
                          {pk.name ?? "Unnamed passkey"}
                          <Badge variant="success" size="sm">
                            Active
                          </Badge>
                        </span>
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(pk.id)}
                        disabled={isPending}
                      >
                        Delete
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}

            {error && <Alert variant="destructive">{error}</Alert>}

            <Field className="flex items-end gap-2">
              <div className="flex-1">
                <FieldLabel htmlFor="passkey-name">Name</FieldLabel>
                <Input
                  id="passkey-name"
                  placeholder="Passkey name (optional)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <Button variant="secondary" onClick={handleAdd} disabled={isPending}>
                Add Passkey
              </Button>
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
