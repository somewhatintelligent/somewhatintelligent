import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CameraIcon, CheckIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@si/ui/components/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { Badge } from "@si/ui/components/badge";
import { Button, buttonVariants } from "@si/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import { DialogTrigger } from "@si/ui/components/dialog";
import { toast } from "@si/ui/components/sonner";
import { cn } from "@si/ui/lib/utils";
import { removeAvatarFn } from "@/lib/avatar.functions";
import { AvatarUploadDialog } from "@/components/account/avatar-upload-dialog";
import { ChangeEmailDialog } from "@/components/account/change-email-dialog";
import { EditNameDialog } from "@/components/account/edit-name-dialog";
import { EditUsernameDialog } from "@/components/account/edit-username-dialog";
import { isAdminRole } from "@/lib/session";

export type IdentityUser = {
  name: string;
  username: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string | null;
  createdAt: number | string | Date | null | undefined;
};

export function IdentityCard({ user }: { user: IdentityUser }) {
  const initial = user.name?.charAt(0).toUpperCase() ?? "?";
  const joined = formatJoined(user.createdAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
        <CardDescription>How you appear across Platform services.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Hero row: avatar + Boska username, full-width. */}
        <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:gap-6">
          <AvatarBlock image={user.image} initial={initial} />
          <div className="flex flex-1 flex-col items-center gap-2 md:items-start">
            <div className="flex w-full items-baseline justify-between gap-3">
              <span className="type-mono-label text-muted-foreground/80">Username</span>
              <EditUsernameDialog defaultUsername={user.username} />
            </div>
            <span
              className={cn(
                "type-display-title font-heading break-all",
                !user.username && "text-muted-foreground/80 italic",
              )}
            >
              {user.username ? (
                <>
                  <span className="font-light text-muted-foreground/80" aria-hidden="true">
                    &amp;
                  </span>
                  <span>{user.username}</span>
                </>
              ) : (
                "Not set"
              )}
            </span>
          </div>
        </div>

        {/* Compact rows for the rest. */}
        <div className="mt-6 flex flex-col">
          <FieldRow label="Display name" value={user.name}>
            <EditNameDialog defaultName={user.name} />
          </FieldRow>
          <FieldDivider />
          <FieldRow
            label="Email"
            value={
              <span className="flex flex-wrap items-center gap-2">
                <span>{user.email}</span>
                {user.emailVerified ? (
                  <Badge variant="success" size="sm">
                    <CheckIcon className="size-3" />
                    <span>Verified</span>
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    Unverified
                  </Badge>
                )}
              </span>
            }
          >
            <ChangeEmailDialog defaultEmail={user.email} />
          </FieldRow>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground/80">
          <Badge variant={isAdminRole(user.role) ? "default" : "secondary"} size="sm">
            {user.role ?? "user"}
          </Badge>
          {joined && <span>· joined {joined}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function AvatarBlock({ image, initial }: { image: string | null; initial: string }) {
  const router = useRouter();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await removeAvatarFn();
      toast.success("Avatar removed");
      setRemoveOpen(false);
      void router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  // The trigger, the avatar, and the hover overlay all share the same
  // size-20 box so the overlay aligns exactly with the avatar tile —
  // no border/padding fudging from the underlying <button>.
  return (
    <div className="flex flex-col items-center gap-2">
      <AvatarUploadDialog
        fallbackInitial={initial}
        trigger={
          <DialogTrigger
            type="button"
            aria-label={image ? "Change photo" : "Add photo"}
            className="group relative block size-20 cursor-pointer appearance-none overflow-hidden rounded-sm border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Avatar className="size-20">
              {image ? <AvatarImage src={image} alt="" /> : null}
              <AvatarFallback className="text-2xl">{initial}</AvatarFallback>
            </Avatar>
            <span className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-1 rounded-sm bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity md:flex md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
              <CameraIcon className="size-3.5" />
              Change
            </span>
          </DialogTrigger>
        }
      />
      <AvatarUploadDialog
        fallbackInitial={initial}
        trigger={
          <DialogTrigger
            type="button"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "md:hidden")}
          >
            {image ? "Change photo" : "Add photo"}
          </DialogTrigger>
        }
      />
      {image && (
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground/80"
            onClick={() => setRemoveOpen(true)}
          >
            Remove
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove avatar?</AlertDialogTitle>
              <AlertDialogDescription>
                Your fallback initials will be shown until you upload a new one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: "destructive" }))}
                onClick={handleRemove}
                disabled={removing}
              >
                {removing ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  children,
}: {
  label: string;
  value: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="flex items-start justify-between gap-3 md:flex-1 md:items-center">
        <div className="flex flex-1 flex-col">
          <span className="type-mono-label text-muted-foreground/80">{label}</span>
          <span className="text-sm break-all md:text-base">{value}</span>
        </div>
        <div className="md:hidden">{children}</div>
      </div>
      <div className="hidden md:block">{children}</div>
    </div>
  );
}

function FieldDivider() {
  return <div className="border-b border-border" />;
}

function formatJoined(value: number | string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
