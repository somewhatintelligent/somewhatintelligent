import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCapture } from "@/lib/analytics";
import { buttonVariants } from "@si/ui/components/button";
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
import { toast } from "@si/ui/components/sonner";
import { authClient } from "@/lib/auth-client";

export function DeleteAccountDialog() {
  const navigate = useNavigate();
  const capture = useCapture();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const result = await authClient.deleteUser();
    if (result.error) {
      toast.error(result.error.message ?? "Failed to delete account");
      setLoading(false);
      return;
    }
    capture("account_deleted", {});
    void navigate({ to: "/sign-in" });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger className={cn(buttonVariants({ variant: "destructive", size: "sm" }))}>
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Account</AlertDialogTitle>
          <AlertDialogDescription>
            This is permanent. There is no grace period, no archive, no "we kept a backup just in
            case." If you wish to return, you will begin again from nothing.
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
            {loading ? "Deleting\u2026" : "Delete Account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
