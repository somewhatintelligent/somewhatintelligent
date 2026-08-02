import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { createClient, type CreateClientResult } from "@/lib/admin-clients.functions";

export const Route = createFileRoute("/_dashboard/admin/clients/new")({
  head: () => ({ meta: [{ title: "New Client — Admin" }] }),
  component: NewClientPage,
});

function NewClientPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section">
        <h1 className="type-page-title">Register Client</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A new application wishes to participate in the identity apparatus.
        </p>
      </div>

      <CreateClientForm />
    </div>
  );
}

const createClientSchema = type({
  name: "string >= 2",
  redirectUris: "string[]",
  skipConsent: "boolean",
});

function CreateClientForm() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateClientResult | null>(null);

  const form = useAppForm({
    defaultValues: {
      name: "",
      redirectUris: [""],
      skipConsent: false,
    },
    validators: { onBlur: createClientSchema },
    onSubmit: async ({ value }) => {
      setError(null);

      const uris = value.redirectUris.filter((u) => u.trim() !== "");
      if (uris.length === 0) {
        setError("At least one redirect URI is required. This should be self-evident.");
        return;
      }

      try {
        const result = await createClient({
          data: {
            name: value.name,
            redirectUris: uris,
            skipConsent: value.skipConsent,
          },
        });

        setCreated(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    },
  });

  if (created) {
    return (
      <Card className="p-page">
        <CardHeader>
          <CardTitle>Client registered.</CardTitle>
          <CardDescription>
            These credentials will not be shown again. One would imagine you should copy them now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <div className="rounded-sm bg-surface-sunken px-4 py-3">
            <div className="type-mono-label mb-1 text-muted-foreground/80">Client ID</div>
            <code className="type-code break-all text-primary">{created.clientId}</code>
          </div>
          <div className="rounded-sm bg-surface-sunken px-4 py-3">
            <div className="type-mono-label mb-1 text-muted-foreground/80">Client Secret</div>
            <code className="type-code break-all text-primary">{created.clientSecret}</code>
          </div>
          <Button
            variant="secondary"
            className="w-full justify-center"
            onClick={() => navigate({ to: "/admin/clients" })}
          >
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-page">
      <CardContent className="space-y-0 p-0">
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                placeholder="My Application"
                description="Human-readable name shown on the consent screen."
              />
            )}
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
                            placeholder="https://my-app.platform.example/api/auth/callback/platform"
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
                  Where the user is sent after authorization. Add all valid URIs — development,
                  preview, production, and so on.
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

          <form.AppForm>
            <form.SubmitButton label="Register Client" className="w-full justify-center py-3.5" />
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}
