import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { buttonVariants } from "@si/ui/components/button";
import { cn } from "@si/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogFooter,
} from "@si/ui/components/dialog";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

const emailSchema = type({ email: "string.email" });

export function ChangeEmailDialog({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useAppForm({
    defaultValues: { email: defaultEmail },
    validators: { onBlur: emailSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setSuccess(false);

      if (value.email === defaultEmail) {
        setError("That is already your email. One would imagine you knew this.");
        return;
      }

      const result = await authClient.changeEmail({
        newEmail: value.email,
        callbackURL: new URL("/account", window.location.origin).toString(),
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to initiate email change.");
        return;
      }

      setSuccess(true);
      void router.invalidate();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSuccess(false);
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        Change
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Email</DialogTitle>
          <DialogDescription>
            A confirmation will be sent to your current email address first. Then a verification
            link to the new one. The usual bureaucratic chain of custody.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col gap-4">
            <Alert variant="success">
              Confirmation sent to your current email. Check it, click the link, and so on.
            </Alert>
            <DialogClose
              className={cn(buttonVariants({ variant: "secondary" }), "w-full justify-center")}
            >
              Done
            </DialogClose>
          </div>
        ) : (
          <form
            method="post"
            action="/api/auth/change-email"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="email">
              {(field) => <field.EmailField label="New email" />}
            </form.AppField>
            {error && <Alert variant="destructive">{error}</Alert>}
            <DialogFooter>
              <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</DialogClose>
              <form.AppForm>
                <form.SubmitButton label="Change Email" />
              </form.AppForm>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
