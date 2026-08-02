import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "platform.ui/components/avatar";
import { Badge } from "platform.ui/components/badge";
import { Button, buttonVariants } from "platform.ui/components/button";
import { Input } from "platform.ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "platform.ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "platform.ui/components/alert-dialog";
import { toast } from "platform.ui/components/sonner";
import { cn } from "platform.ui/lib/utils";
import { authClient } from "@/lib/auth-client";
import { getUsers, USERS_PAGE_SIZE, type AdminUser } from "@/lib/admin-users.functions";
import { AddUserModal } from "@/components/admin/add-user-modal";
import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { SetPasswordDialog } from "@/components/admin/set-password-dialog";
import { UserRoleDialog } from "@/components/admin/user-role-dialog";
import { isAdminRole } from "@/lib/session";

export const Route = createFileRoute("/_dashboard/admin/users")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    page: typeof search.page === "number" && search.page > 1 ? search.page : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getUsers({ data: deps }),
  head: () => ({ meta: [{ title: "Users — Admin" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { users, total } = Route.useLoaderData();
  const { q, page = 1 } = Route.useSearch();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const currentUserId = session!.user.id;
  const [addOpen, setAddOpen] = useState(false);
  const [searchValue, setSearchValue] = useState(q ?? "");

  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * USERS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page - 1) * USERS_PAGE_SIZE + users.length);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    void navigate({ search: { q: searchValue.trim() || undefined, page: undefined } });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-page-title">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone who has, ostensibly, proven they exist.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Add user</Button>
      </div>

      <form onSubmit={submitSearch} className="mb-4 flex max-w-md gap-2">
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search by email…"
          aria-label="Search users by email"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="w-12 px-4 py-3" />
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Name
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Email
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Role
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Status
              </th>
              <th className="px-4 py-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/80">
                  {q
                    ? "No users match that search."
                    : "No users yet. One would imagine that will change."}
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Avatar size="sm">
                    {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                    <AvatarFallback>{u.name?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
                  </Avatar>
                </td>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={isAdminRole(u.role) ? "default" : "secondary"}>
                    {u.role ?? "user"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {u.banned ? (
                    <Badge variant="destructive">Banned</Badge>
                  ) : u.emailVerified ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="warning">Pending</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <UserActions user={u} currentUserId={currentUserId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Showing {rangeStart}–{rangeEnd} of {total}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() =>
                  navigate({
                    search: (prev) => ({ ...prev, page: page > 2 ? page - 1 : undefined }),
                  })
                }
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <AddUserModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => void router.invalidate()}
      />
    </div>
  );
}

function UserActions({ user, currentUserId }: { user: AdminUser; currentUserId: string }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelf = user.id === currentUserId;

  async function handleBan() {
    const result = user.banned
      ? await authClient.admin.unbanUser({ userId: user.id })
      : await authClient.admin.banUser({ userId: user.id });
    if (result.error) {
      toast.error(result.error.message ?? `Failed to ${user.banned ? "unban" : "ban"} user`);
      return;
    }
    toast.success(user.banned ? "User unbanned" : "User banned");
    await router.invalidate();
  }

  async function handleImpersonate() {
    const result = await authClient.admin.impersonateUser({ userId: user.id });
    if (result.error) {
      toast.error(result.error.message ?? "Failed to impersonate user");
      return;
    }
    await navigate({ to: "/" });
  }

  async function handleVerifyEmail() {
    const result = await authClient.admin.updateUser({
      userId: user.id,
      data: { emailVerified: true },
    });
    if (result.error) {
      toast.error(result.error.message ?? "Failed to mark email verified");
      return;
    }
    toast.success("Email marked verified");
    await router.invalidate();
  }

  async function handleRevokeSessions() {
    setBusy(true);
    const result = await authClient.admin.revokeUserSessions({ userId: user.id });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "Failed to revoke sessions");
      return;
    }
    toast.success("All sessions revoked");
    setRevokeOpen(false);
    await router.invalidate();
  }

  async function handleDelete() {
    setBusy(true);
    const result = await authClient.admin.removeUser({ userId: user.id });
    if (result.error) {
      toast.error(result.error.message ?? "Failed to delete user");
      setBusy(false);
      return;
    }
    toast.success("User deleted");
    setBusy(false);
    setDeleteOpen(false);
    await router.invalidate();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit details</DropdownMenuItem>
          {!isSelf && (
            <DropdownMenuItem onClick={() => setRoleOpen(true)}>Change role</DropdownMenuItem>
          )}
          {!user.emailVerified && (
            <DropdownMenuItem onClick={handleVerifyEmail}>Mark email verified</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setPasswordOpen(true)}>Set password</DropdownMenuItem>
          {!isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleImpersonate}>Impersonate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRevokeOpen(true)}>
                Revoke sessions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleBan}>
                {user.banned ? "Unban" : "Ban"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive-hover"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={() => void router.invalidate()}
      />
      <UserRoleDialog
        userId={user.id}
        userEmail={user.email}
        currentRole={user.role}
        open={roleOpen}
        onOpenChange={setRoleOpen}
        onSuccess={() => void router.invalidate()}
      />
      <SetPasswordDialog
        userId={user.id}
        userEmail={user.email}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all sessions</AlertDialogTitle>
            <AlertDialogDescription>
              This signs {user.email} out everywhere. They can sign back in immediately unless you
              also ban them or change their credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={handleRevokeSessions}
              disabled={busy}
            >
              {busy ? "Revoking…" : "Revoke sessions"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user and all of their data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
