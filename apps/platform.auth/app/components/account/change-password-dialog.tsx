import { useState } from "react";
import { type } from "arktype";
import { useCapture } from "@/lib/analytics";
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

const passwordSchema = type({
  currentPassword: "string >= 1",
  newPassword: "string >= 8",
  confirmPassword: "string >= 8",
});

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const capture = useCapture();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    validators: { onBlur: passwordSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setSuccess(null);

      if (value.newPassword !== value.confirmPassword) {
        setError("The passwords do not match. Nevertheless, you may try again.");
        return;
      }

      const result = await authClient.changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true,
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to change password.");
        return;
      }

      capture("password_changed", {});
      setSuccess("Password updated. The old one has been retired, and so on.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        Change
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>
            Other sessions will be revoked when you change your password.
          </DialogDescription>
        </DialogHeader>
        <form
          method="post"
          action="/api/auth/change-password"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="currentPassword">
            {(field) => <field.PasswordField label="Current password" />}
          </form.AppField>
          <form.AppField name="newPassword">
            {(field) => <field.PasswordField label="New password" />}
          </form.AppField>
          <form.AppField name="confirmPassword">
            {(field) => <field.PasswordField label="Confirm new password" />}
          </form.AppField>

          {error && <Alert variant="destructive">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</DialogClose>
            <form.AppForm>
              <form.SubmitButton label="Change Password" />
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
