import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { Badge } from "@si/ui/components/badge";
import { Button, buttonVariants } from "@si/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@si/ui/components/dropdown-menu";
import { toast } from "@si/ui/components/sonner";
import { cn } from "@si/ui/lib/utils";
import { AddMemberModal } from "@/components/admin/add-member-modal";
import { EditOrgDialog } from "@/components/admin/edit-org-dialog";
import { InviteMemberModal } from "@/components/admin/invite-member-modal";
import { MemberActions } from "@/components/admin/member-actions";
import {
  cancelOrgInvitation,
  getOrgForAdmin,
  removeOrgMember,
  resendOrgInvitation,
  updateOrgMemberRole,
  type OrgInvitation,
  type OrgMember,
} from "@/lib/org-admin.functions";
import { relativeTime } from "@/lib/relative-time";

export const Route = createFileRoute("/_dashboard/admin/orgs/$id")({
  loader: ({ params }) => getOrgForAdmin({ data: { orgId: params.id } }),
  head: () => ({ meta: [{ title: "Organization — Admin" }] }),
  component: OrgDetailPage,
});

type Role = "owner" | "admin" | "member";

function parseThemePrimary(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as {
      theme?: { light?: Record<string, string>; dark?: Record<string, string> };
    };
    return parsed.theme?.light?.["--color-primary"] ?? null;
  } catch {
    return null;
  }
}

function OrgDetailPage() {
  const { organization, members, invitations } = Route.useLoaderData();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const orgId = organization.id;

  const themePrimary = parseThemePrimary(organization.metadata);
  const ownerCount = members.filter((m) => m.role === "owner").length;

  async function refresh() {
    await router.invalidate();
  }

  async function handleChangeRole(member: OrgMember, nextRole: Role) {
    try {
      await updateOrgMemberRole({
        data: { orgId, userId: member.userId, role: nextRole },
      });
      toast.success(`Updated ${member.name ?? member.email ?? "member"} to ${nextRole}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function handleRemoveMember(member: OrgMember) {
    try {
      await removeOrgMember({ data: { orgId, userId: member.userId } });
      toast.success(`Removed ${member.name ?? member.email ?? "member"}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handleCancelInvitation(inv: OrgInvitation) {
    try {
      await cancelOrgInvitation({ data: { orgId, invitationId: inv.id } });
      toast.success("Invitation cancelled");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel invitation");
    }
  }

  async function handleResendInvitation(inv: OrgInvitation) {
    try {
      const result = await resendOrgInvitation({ data: { orgId, invitationId: inv.id } });
      if (result.ok) {
        if (result.emailSent) {
          toast.success("Invitation email resent");
        } else {
          toast.warning("Invitation renewed — email delivery unavailable, copy the link instead");
        }
      } else {
        toast.error(result.message);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend invitation");
    }
  }

  async function copyAcceptLink(inv: OrgInvitation) {
    const base = import.meta.env.IDENTITY_URL || window.location.origin;
    const url = `${base}/orgs/accept/${inv.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy — copy manually: " + url);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-grid">
      <div className="mb-grid flex items-start justify-between gap-2">
        <div>
          <h1 className="type-page-title">{organization.name}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground/80">{organization.slug}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="type-mono-label text-muted-foreground/80">Created</dt>
              <dd className="mt-1">{relativeTime(organization.createdAt)}</dd>
            </div>
            <div>
              <dt className="type-mono-label text-muted-foreground/80">Members</dt>
              <dd className="mt-1 font-mono">{members.length}</dd>
            </div>
            <div>
              <dt className="type-mono-label text-muted-foreground/80">Plan</dt>
              <dd className="mt-1">
                <Badge variant="warning">trial</Badge>
              </dd>
            </div>
            <div>
              <dt className="type-mono-label text-muted-foreground/80">Theme</dt>
              <dd className="mt-1 flex items-center gap-2">
                {themePrimary ? (
                  <>
                    <span
                      className="inline-block size-3 rounded-sm border border-border"
                      style={{ backgroundColor: themePrimary }}
                      aria-hidden
                    />
                    <span className="font-mono text-xs">{themePrimary}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground/80">default</span>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>People with active access to {organization.name}.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              + Invite by email
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add member
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto border-t-2 border-border-strong">
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
                    Joined
                  </th>
                  <th className="px-4 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {members.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/80">
                      No members yet.
                    </td>
                  </tr>
                )}
                {members.map((m) => {
                  const isOnlyOwner = m.role === "owner" && ownerCount <= 1;
                  return (
                    <tr key={m.memberId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <Avatar size="sm">
                          {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                          <AvatarFallback>
                            {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </td>
                      <td className="px-4 py-3 font-medium">{m.name ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                        {m.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={m.role} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                        {relativeTime(m.joinedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MemberActions
                          memberName={m.name ?? m.email ?? "member"}
                          orgName={organization.name}
                          currentRole={(m.role as Role) ?? "member"}
                          isOnlyOwner={isOnlyOwner}
                          onChangeRole={(next) => handleChangeRole(m, next)}
                          onRemove={() => handleRemoveMember(m)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              Operator-issued invitations. Email delivery is manual — copy the link to send.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto border-t-2 border-border-strong">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-border-strong bg-surface-sunken">
                    <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                      Email
                    </th>
                    <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                      Role
                    </th>
                    <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                      Expires
                    </th>
                    <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                      Invited by
                    </th>
                    <th className="px-4 py-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{inv.email}</td>
                      <td className="px-4 py-3">
                        <RoleBadge role={inv.role} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                        {relativeTime(inv.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {inv.inviterName ?? <span className="text-muted-foreground/80">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                            aria-label={`Actions for invitation to ${inv.email}`}
                          >
                            ⋯
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void handleResendInvitation(inv)}>
                              Resend email
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void copyAcceptLink(inv)}>
                              Copy accept link
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive-hover"
                              onClick={() => void handleCancelInvitation(inv)}
                            >
                              Cancel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <EditOrgDialog
        orgId={orgId}
        currentName={organization.name}
        currentSlug={organization.slug}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={(org) => {
          toast.success(`Updated ${org.name}`);
          void refresh();
        }}
      />
      <AddMemberModal
        orgId={orgId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => {
          toast.success("Member added");
          void refresh();
        }}
      />
      <InviteMemberModal
        orgId={orgId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => void refresh()}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "owner") return <Badge variant="default">owner</Badge>;
  if (role === "admin") return <Badge variant="warning">admin</Badge>;
  return <Badge variant="secondary">{role}</Badge>;
}
