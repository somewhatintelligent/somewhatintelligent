import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";
import { rpcErrorMessage, rpcMessage } from "@/lib/rpc-error";
import { requireAdmin } from "@/lib/server-fn-actor";

// ------------------------------------------------------------------
// Shapes returned to the client. We narrow the loose RPC row shapes
// (which include `unknown`-typed nested fields from the Drizzle row
// shape) into typed payloads the routes can rely on.
// ------------------------------------------------------------------

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  createdAt: string | number | Date | null;
  memberCount: number;
  ownerName: string | null;
}

export interface OrgMember {
  memberId: string;
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  joinedAt: string | number | Date | null;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | number | Date | null;
  inviterName: string | null;
}

interface OrgDetailPayload {
  organization: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
    createdAt: string | number | Date | null;
    metadata: string | null;
  };
  members: OrgMember[];
  invitations: OrgInvitation[];
}

export interface UserSearchHit {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

type OrgRole = "owner" | "admin" | "member";

// ------------------------------------------------------------------
// Server functions — each one wraps a single RPC method on the auth
// worker. The inbound Cookie is the sole credential (threaded explicitly);
// the admin gate runs both in middleware here AND inside the worker's own
// check.
// ------------------------------------------------------------------

export const listOrgsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<{ orgs: OrgRow[] }> => {
    const res = await baeClient().adminListOrgs({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return { orgs: res.organizations };
  });

export const searchUsersByEmail = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: { email: string }) => data)
  .handler(async ({ context, data }): Promise<{ users: UserSearchHit[] }> => {
    const res = await baeClient().adminSearchUsersByEmail({
      cookie: context.cookie,
      email: data.email,
    });
    if (!res.ok) throw new Error(res.error);
    return { users: res.users };
  });

export const getOrgForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string }) => data)
  .handler(async ({ context, data }): Promise<OrgDetailPayload> => {
    const res = await baeClient().adminGetOrg({ cookie: context.cookie, id: data.orgId });
    if (!res.ok) {
      if (res.error === "not_found") throw notFound();
      throw new Error(res.error);
    }
    return {
      organization: res.organization as OrgDetailPayload["organization"],
      members: res.members,
      invitations: res.invitations,
    };
  });

export const createOrgAsOperator = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { name: string; slug: string; ownerUserId: string }) => data)
  .handler(
    async ({
      context,
      data,
    }): Promise<
      | { ok: true; organization: { id: string; slug: string; name: string } }
      | { ok: false; error: "slug_taken" | "unknown"; message: string }
    > => {
      const res = await baeClient().adminCreateOrg({
        cookie: context.cookie,
        name: data.name,
        slug: data.slug,
        ownerUserId: data.ownerUserId,
      });
      if (!res.ok) {
        if (res.error === "slug_taken") {
          return {
            ok: false,
            error: "slug_taken",
            message: rpcMessage(res) ?? "Slug already taken",
          };
        }
        return { ok: false, error: "unknown", message: rpcErrorMessage(res) };
      }
      const org = res.organization as { id: string; slug: string; name: string } | undefined;
      if (!org) {
        return { ok: false, error: "unknown", message: "No org returned from server" };
      }
      return { ok: true, organization: org };
    },
  );

export const updateOrgAsOperator = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; name: string; slug: string }) => data)
  .handler(
    async ({
      context,
      data,
    }): Promise<
      | { ok: true; organization: { id: string; slug: string; name: string } }
      | { ok: false; error: "slug_taken" | "unknown"; message: string }
    > => {
      const res = await baeClient().adminUpdateOrg({
        cookie: context.cookie,
        id: data.orgId,
        name: data.name,
        slug: data.slug,
      });
      if (!res.ok) {
        if (res.error === "slug_taken") {
          return {
            ok: false,
            error: "slug_taken",
            message: rpcMessage(res) ?? "Slug already taken",
          };
        }
        return { ok: false, error: "unknown", message: rpcErrorMessage(res) };
      }
      const org = res.organization as { id: string; slug: string; name: string } | undefined;
      if (!org) {
        return { ok: false, error: "unknown", message: "No org returned from server" };
      }
      return { ok: true, organization: org };
    },
  );

export const addOrgMember = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; userId: string; role: OrgRole }) => data)
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminAddOrgMember({
      cookie: context.cookie,
      orgId: data.orgId,
      userId: data.userId,
      role: data.role,
    });
    if (!res.ok) {
      if (res.error === "already_member") {
        throw new Error("This user is already a member of this org.");
      }
      if (res.error === "not_found") {
        throw new Error("User not found.");
      }
      throw new Error(rpcErrorMessage(res));
    }
    return { success: true as const };
  });

export const updateOrgMemberRole = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; userId: string; role: OrgRole }) => data)
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminUpdateOrgMemberRole({
      cookie: context.cookie,
      orgId: data.orgId,
      userId: data.userId,
      role: data.role,
    });
    if (!res.ok) {
      if (res.error === "cannot_demote_last_owner") {
        throw new Error("Cannot demote the only owner of this org.");
      }
      if (res.error === "member_not_found") {
        throw new Error("Member not found.");
      }
      throw new Error(res.error);
    }
    return { success: true as const };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; userId: string }) => data)
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminRemoveOrgMember({
      cookie: context.cookie,
      orgId: data.orgId,
      userId: data.userId,
    });
    if (!res.ok) {
      if (res.error === "cannot_remove_last_owner") {
        throw new Error("Cannot remove the only owner of this org.");
      }
      if (res.error === "member_not_found") {
        throw new Error("Member not found.");
      }
      throw new Error(res.error);
    }
    return { success: true as const };
  });

export const createOrgInvitation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; email: string; role: OrgRole }) => data)
  .handler(async ({ context, data }): Promise<{ invitationId: string; emailSent: boolean }> => {
    const res = await baeClient().adminCreateOrgInvitation({
      cookie: context.cookie,
      orgId: data.orgId,
      email: data.email,
      role: data.role,
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    const inv = res.invitation as { id: string } | undefined;
    if (!inv) throw new Error("No invitation returned from server");
    // Operator-issued invitations never send email (see
    // adminCreateOrgInvitation) — emailSent is always false. Kept as a real
    // field so the UI's "email sent" branch is ready the moment the auth
    // server adds delivery.
    return { invitationId: inv.id, emailSent: false };
  });

export const resendOrgInvitation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; invitationId: string }) => data)
  .handler(
    async ({
      context,
      data,
    }): Promise<
      | { ok: true; emailSent: boolean; expiresAt: number }
      | {
          ok: false;
          error: "invitation_not_found" | "invitation_not_pending";
          message: string;
        }
    > => {
      const res = await baeClient().adminResendOrgInvitation({
        cookie: context.cookie,
        orgId: data.orgId,
        invitationId: data.invitationId,
      });
      if (!res.ok) {
        if (res.error === "invitation_not_found") {
          return {
            ok: false,
            error: "invitation_not_found",
            message: "Invitation not found.",
          };
        }
        return {
          ok: false,
          error: "invitation_not_pending",
          message: `Invitation is already ${rpcMessage(res) ?? "resolved"}.`,
        };
      }
      return {
        ok: true,
        emailSent: true,
        expiresAt: new Date(res.invitation.expiresAt).getTime(),
      };
    },
  );

export const cancelOrgInvitation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { orgId: string; invitationId: string }) => data)
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminCancelOrgInvitation({
      cookie: context.cookie,
      orgId: data.orgId,
      invitationId: data.invitationId,
    });
    if (!res.ok) throw new Error(res.error);
    return { success: true as const };
  });
