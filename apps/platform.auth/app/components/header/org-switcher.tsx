import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, MailIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@si/ui/components/dropdown-menu";
import { toast } from "@si/ui/components/sonner";
import { authClient } from "@/lib/auth-client";

type Membership = {
  id: string;
  name: string;
  slug: string;
};

type PendingInvite = {
  id: string;
  organizationName: string;
};

export function OrgSwitcher({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [orgsRes, activeRes, invitesRes] = await Promise.all([
        authClient.organization.list(),
        authClient.organization.getFullOrganization().catch(() => ({ data: null, error: null })),
        authClient.organization.listUserInvitations().catch(() => ({ data: [], error: null })),
      ]);
      if (cancelled) return;
      const orgs = (orgsRes.data ?? []) as Array<{ id: string; name: string; slug: string }>;
      setMemberships(orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })));
      const active = (activeRes as { data?: { id?: string } | null } | null)?.data;
      setActiveOrgId(active?.id ?? null);
      const allInvites = (
        (invitesRes.data ?? []) as Array<{
          id: string;
          status: string;
          organizationName?: string;
        }>
      ).filter((i) => i.status === "pending");
      setInvites(
        allInvites.map((i) => ({
          id: i.id,
          organizationName: i.organizationName ?? "Organization",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (memberships === null) return null;
  if (memberships.length === 0 && invites.length === 0) return null;

  const active = memberships.find((m) => m.id === activeOrgId) ?? null;
  const label = active?.name ?? "Select organization";

  async function handleSwitch(organizationId: string) {
    setSwitching(organizationId);
    const res = await authClient.organization.setActive({ organizationId });
    setSwitching(null);
    if (res.error) {
      toast.error(res.error.message ?? "Failed to switch organization");
      return;
    }
    setActiveOrgId(organizationId);
    await router.invalidate();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2">
            <Building2Icon className="size-4" />
            <span className="max-w-[180px] truncate">{label}</span>
            <ChevronsUpDownIcon className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {memberships.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {memberships.map((m) => {
              const isActive = m.id === activeOrgId;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => {
                    if (!isActive && switching === null) void handleSwitch(m.id);
                  }}
                >
                  <span className="flex-1 truncate">{m.name}</span>
                  {isActive ? <CheckIcon className="size-4 opacity-80" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        )}
        {invites.length > 0 && (
          <>
            {memberships.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Pending invitations</DropdownMenuLabel>
              {invites.map((inv) => (
                <DropdownMenuItem
                  key={inv.id}
                  render={
                    <Link to="/orgs/accept/$invitationId" params={{ invitationId: inv.id }} />
                  }
                >
                  <MailIcon className="size-4 opacity-70" />
                  <span className="flex-1 truncate">{inv.organizationName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/admin/orgs" />}>Manage orgs</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
