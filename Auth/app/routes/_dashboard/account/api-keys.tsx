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

export const Route = createFileRoute("/_dashboard/account/api-keys")({
  head: () => ({ meta: [{ title: "API Keys — Identity" }] }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<
    Array<{ id: string; name: string | null; enabled: boolean | null; createdAt: Date }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function loadKeys() {
    const result = await authClient.apiKey.list();
    if (result.error) {
      setError(result.error.message ?? "Failed to load API keys.");
      return;
    }
    if (result.data) {
      setKeys(result.data.apiKeys as typeof keys);
    }
    setLoaded(true);
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  function handleCreate() {
    startTransition(async () => {
      setError(null);
      if (!name.trim()) return;

      const result = await authClient.apiKey.create({
        name: name.trim(),
        prefix: "platform",
      });
      if (result.error) {
        setError(result.error.message ?? "Failed to create API key.");
        return;
      }
      if (result.data?.key) {
        setCreatedKey(result.data.key);
      }
      setName("");
      await loadKeys();
    });
  }

  function handleDelete(keyId: string) {
    startTransition(async () => {
      setError(null);
      const result = await authClient.apiKey.delete({ keyId });
      if (result.error) {
        setError(result.error.message ?? "Failed to delete API key.");
        return;
      }
      await loadKeys();
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid">
        <h1 className="type-page-title">API Keys</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your API Keys</CardTitle>
          <CardDescription>For programmatic access to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {createdKey && (
              <div className="rounded-sm bg-surface-sunken px-4 py-3">
                <div className="type-mono-label mb-1 text-muted-foreground/80">New Key</div>
                <code className="type-code break-all text-primary">{createdKey}</code>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  This will not be shown again.
                </p>
              </div>
            )}

            {error && <Alert variant="destructive">{error}</Alert>}

            {loaded && keys.length > 0 && (
              <ItemGroup>
                {keys.map((k) => (
                  <Item key={k.id} variant="surface" size="sm">
                    <ItemContent>
                      <ItemTitle>
                        <span className="flex items-center gap-2">
                          {k.name ?? "Unnamed"}
                          <Badge variant={k.enabled ? "success" : "secondary"} size="sm">
                            {k.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </span>
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(k.id)}
                        disabled={isPending}
                      >
                        Delete
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}

            {loaded && keys.length === 0 && (
              <p className="text-sm text-muted-foreground/80">No API keys yet.</p>
            )}

            <Field className="flex items-end gap-2">
              <div className="flex-1">
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input
                  id="api-key-name"
                  placeholder="Key name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <Button
                variant="secondary"
                onClick={handleCreate}
                disabled={!name.trim() || isPending}
              >
                Create
              </Button>
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
