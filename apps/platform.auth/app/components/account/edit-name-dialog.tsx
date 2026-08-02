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

const nameSchema = type({ name: "string >= 1" });

export function EditNameDialog({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { name: defaultName },
    validators: { onBlur: nameSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await authClient.updateUser({ name: value.name });
      if (result.error) {
        setError(result.error.message ?? "Failed to update name.");
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
          <DialogTitle>Edit Name</DialogTitle>
          <DialogDescription>
            What you go by. It appears on consent screens when other applications ask who you are.
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
          <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
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
