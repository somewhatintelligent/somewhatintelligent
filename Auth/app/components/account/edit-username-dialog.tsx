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

const usernameSchema = type({
  username: "/^[a-zA-Z0-9_.]{3,30}$/",
});

export function EditUsernameDialog({ defaultUsername }: { defaultUsername: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { username: defaultUsername ?? "" },
    validators: { onBlur: usernameSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await authClient.updateUser({ username: value.username });
      if (result.error) {
        setError(result.error.message ?? "Failed to update username.");
        return;
      }
      setOpen(false);
      void router.invalidate();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Username</DialogTitle>
          <DialogDescription>
            Your handle. Letters, digits, dots, and underscores only — 3 to 30 characters.
          </DialogDescription>
        </DialogHeader>
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="username">
            {(field) => <field.TextField label="Username" />}
          </form.AppField>
          {error && <Alert variant="destructive">{error}</Alert>}
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</DialogClose>
            <form.AppForm>
              <form.SubmitButton label="Save" />
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
