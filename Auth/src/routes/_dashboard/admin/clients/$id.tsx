import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Button, buttonVariants } from "@si/ui/components/button";
import { cn } from "@si/ui/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@si/ui/components/alert-dialog";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { Badge } from "@si/ui/components/badge";
import { isManaged } from "@/lib/clients";
import { deleteClient, getClient, rotateSecret, updateClient } from "@/lib/admin-clients.functions";

export const Route = createFileRoute("/_dashboard/admin/clients/$id")({
  loader: ({ params }) => getClient({ data: { id: params.id } }),
  head: () => ({ meta: [{ title: "Edit Client — Admin" }] }),
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { client: c, tokenCount, consentCount } = Route.useLoaderData();
  const managed = isManaged(c.referenceId);
  const redirectUris = c.redirectUris;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid flex items-center justify-between">
        <h1 className="type-page-title">{c.name ?? c.clientId}</h1>
        <div className="flex items-center gap-2">
          {managed ? (
            <Badge variant="warning">Managed</Badge>
          ) : (
            <Badge variant="default">Custom</Badge>
          )}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-grid lg:grid-cols-[1fr_minmax(260px,320px)]">
        <EditClientForm
          client={{
            id: c.id,
            name: c.name ?? "",
            redirectUris,
            skipConsent: c.skipConsent ?? false,
          }}
        />

        <div className="flex flex-col gap-grid">
          {managed && <Alert variant="warning">Managed by IaC. Identity is immutable.</Alert>}

          <div className="rounded-sm bg-surface-sunken px-4 py-3">
            <div className="type-mono-label mb-1 text-muted-foreground/80">Client ID</div>
            <code className="type-code break-all text-foreground">{c.clientId}</code>
          </div>

          <div className="grid grid-cols-2 gap-grid">
            <div className="rounded-sm bg-surface-sunken px-4 py-3">
              <div className="type-mono-label text-muted-foreground/80">Tokens</div>
              <div className="type-stat mt-1">{tokenCount}</div>
            </div>
            <div className="rounded-sm bg-surface-sunken px-4 py-3">
              <div className="type-mono-label text-muted-foreground/80">Consents</div>
              <div className="type-stat mt-1">{consentCount}</div>
            </div>
          </div>

          <ClientSecretCard id={c.id} />

          {!managed && <DeleteClientCard id={c.id} />}
        </div>
      </div>
    </div>
  );
}

const editClientSchema = type({
  name: "string >= 2",
  redirectUris: "string[]",
  skipConsent: "boolean",
});

interface ClientData {
  id: string;
  name: string;
  redirectUris: string[];
  skipConsent: boolean;
}

function EditClientForm({ client }: { client: ClientData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      name: client.name,
      redirectUris: client.redirectUris.length > 0 ? client.redirectUris : [""],
      skipConsent: client.skipConsent,
    },
    validators: { onBlur: editClientSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setSuccess(null);

      const uris = value.redirectUris.filter((u) => u.trim() !== "");

      try {
        await updateClient({
          data: {
            id: client.id,
            name: value.name,
            redirectUris: uris,
            skipConsent: value.skipConsent,
          },
        });
        setSuccess("Updated.");
        await router.invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    },
  });

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Client identity and authorization settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" description="Shown on the consent screen." />}
          </form.AppField>

          <form.Field name="redirectUris" mode="array">
            {(field) => (
              <Field>
                <Label>Redirect URIs</Label>
                <div className="flex flex-col gap-2">
                  {field.state.value.map((_, i) => (
                    <div key={i} className="flex gap-2">
                      <form.Field name={`redirectUris[${i}]`}>
                        {(subField) => (
                          <Input
                            value={subField.state.value}
                            onBlur={subField.handleBlur}
                            onChange={(e) => subField.handleChange(e.target.value)}
                            placeholder="https://..."
                          />
                        )}
                      </form.Field>
                      {field.state.value.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => field.removeValue(i)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => field.pushValue("")}
                >
                  Add URI
                </Button>
                <FieldDescription>
                  Add all valid URIs — development, preview, production, and so on.
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.AppField name="skipConsent">
            {(field) => (
              <field.SwitchField
                label="Skip consent screen"
                description="First-party apps that you trust implicitly."
              />
            )}
          </form.AppField>

          {error && <Alert variant="destructive">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <form.AppForm>
            <form.SubmitButton label="Save Changes" className="w-full justify-center py-3.5" />
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}

function ClientSecretCard({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  async function handleRotateSecret() {
    setError(null);
    setRotatedSecret(null);
    try {
      const result = await rotateSecret({ data: { id } });
      setRotatedSecret(result.clientSecret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rotate secret.");
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Client Secret</CardTitle>
        <CardDescription>Invalidates the current secret immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        {rotatedSecret ? (
          <div className="rounded-sm bg-surface-sunken px-3 py-2">
            <code className="type-code break-all text-primary">{rotatedSecret}</code>
            <p className="mt-1.5 text-2xs text-muted-foreground/80">Will not be shown again.</p>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-center"
            onClick={handleRotateSecret}
          >
            Rotate Secret
          </Button>
        )}
        {error && (
          <Alert variant="destructive" className="mt-2">
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteClientCard({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await deleteClient({ data: { id } });
      await router.navigate({ to: "/admin/clients" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
      setLoading(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Permanently delete this client and revoke all tokens.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger
            className={cn(
              buttonVariants({ variant: "destructive", size: "sm" }),
              "w-full justify-center",
            )}
          >
            Delete Client
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Client</AlertDialogTitle>
              <AlertDialogDescription>
                This action is irreversible. The client and all its tokens will cease to exist.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: "destructive" }))}
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? "Deleting\u2026" : "Delete Client"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {error && (
          <Alert variant="destructive" className="mt-2">
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
