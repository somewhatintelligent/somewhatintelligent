import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";
import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";
import { getSession } from "@/lib/bae.server";

/**
 * Server-fn wrappers for BA's `/api/auth/organization/*` invitation
 * endpoints. We call the guestlist service binding directly with the
 * inbound request's cookies + origin so BA can resolve the session and
 * pass its CSRF check.
 *
 * We deliberately do NOT route through the auth client here: the
 * `organizationClient()` plugin isn't registered in
 * `@somewhatintelligent/guestlist`'s `src/client/plugins.ts`. Server-side
 * fetch against the service binding is the equivalent path.
 */

const GUESTLIST_INTERNAL = "http://guestlist.internal";

export interface InvitationSummary {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  inviterId: string;
  inviterEmail: string;
  /** Best-effort: BA's `getInvitation` doesn't expose the inviter's display name. */
  inviterName: string | null;
}

export type InvitationFetchResult =
  /** Caller has no session — route renders the "sign in to accept" branch. */
  | { kind: "no-session" }
  /** Invitation visible — caller is the recipient, signed in, email-verified, status pending. */
  | { kind: "ok"; invitation: InvitationSummary; sessionUserEmail: string }
  /** BA returned 403 YOU_ARE_NOT_THE_RECIPIENT — caller is signed in but the invitation is for someone else. */
  | { kind: "wrong-recipient"; sessionUserEmail: string }
  /** BA returned 403 EMAIL_VERIFICATION_REQUIRED — caller needs to verify email first. */
  | { kind: "email-unverified"; sessionUserEmail: string }
  /** BA returned 400 "Invitation not found" — expired, cancelled, accepted, or unknown id. */
  | { kind: "not-available"; sessionUserEmail: string };

function forwardHeaders(): Record<string, string> {
  const inbound = getRequest().headers;
  const out: Record<string, string> = {};
  // Cookies carry the BA session — required for the org plugin's middleware.
  const cookie = inbound.get("cookie");
  if (cookie) out["cookie"] = cookie;
  // Mirror sign-in's CSRF-friendly behavior on the POST routes; harmless on GET.
  const origin = inbound.get("origin");
  if (origin) out["origin"] = origin;
  return out;
}

/**
 * Loads the invitation + caller-session info needed by the accept page so
 * the loader can pick which of the four UI branches to render without an
 * extra round-trip.
 */
export const getInvitationForAccept = createServerFn({ method: "GET" })
  .validator((data: { invitationId: string }) => data)
  .handler(async ({ data }): Promise<InvitationFetchResult> => {
    const session = await getSession(getRequestHeaders());
    if (!session) return { kind: "no-session" };

    const sessionUserEmail = session.user.email;

    const url = new URL("/api/auth/organization/get-invitation", GUESTLIST_INTERNAL);
    url.searchParams.set("id", data.invitationId);
    const res = await baeClient().fetch(
      new Request(url.toString(), { method: "GET", headers: forwardHeaders() }),
    );

    if (res.status === 200) {
      const body = (await res.json()) as Record<string, unknown> & {
        id: string;
        email: string;
        role: string;
        status: string;
        expiresAt: string;
        organizationId: string;
        organizationName: string;
        organizationSlug: string;
        inviterId: string;
        inviterEmail: string;
      };
      return {
        kind: "ok",
        sessionUserEmail,
        invitation: {
          id: body.id,
          email: body.email,
          role: body.role,
          status: body.status,
          expiresAt: body.expiresAt,
          organizationId: body.organizationId,
          organizationName: body.organizationName,
          organizationSlug: body.organizationSlug,
          inviterId: body.inviterId,
          inviterEmail: body.inviterEmail,
          // BA's response shape doesn't carry the inviter's display name,
          // so the UI falls back to the email when this is null.
          inviterName: null,
        },
      };
    }

    // BA error responses come back as { code, message } under varying
    // shapes; check both the message text and the status.
    let errorBody: { code?: string; message?: string } | null = null;
    try {
      errorBody = (await res.json()) as { code?: string; message?: string };
    } catch {
      errorBody = null;
    }
    const msg = errorBody?.message ?? "";
    const code = errorBody?.code ?? "";

    if (
      res.status === 403 &&
      (code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" || /not the recipient/i.test(msg))
    ) {
      return { kind: "wrong-recipient", sessionUserEmail };
    }
    if (
      res.status === 403 &&
      (code === "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION" || /email verification/i.test(msg))
    ) {
      return { kind: "email-unverified", sessionUserEmail };
    }
    // Default: 400 "Invitation not found!" covers expired/cancelled/
    // accepted/unknown-id; collapse to the same UI branch.
    return { kind: "not-available", sessionUserEmail };
  });

export type AcceptInvitationResult =
  | { ok: true; organizationSlug: string | null }
  | { ok: false; error: string };

export const acceptInvitation = createServerFn({ method: "POST" })
  .validator((data: { invitationId: string }) => data)
  .handler(async ({ data }): Promise<AcceptInvitationResult> => {
    const res = await baeClient().fetch(
      new Request(`${GUESTLIST_INTERNAL}/api/auth/organization/accept-invitation`, {
        method: "POST",
        headers: { ...forwardHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ invitationId: data.invitationId }),
      }),
    );

    if (res.status === 200) {
      let body: { invitation?: { organizationId?: string } } | null = null;
      try {
        body = (await res.json()) as { invitation?: { organizationId?: string } };
      } catch {
        body = null;
      }
      // BA's accept-invitation response doesn't include the slug —
      // future revisions of this page can redirect to `/orgs/<slug>` once
      // we plumb the slug through (lookup via getFullOrganization on the
      // returned organizationId would do it). Punt for now: redirect to /.
      void body;
      return { ok: true, organizationSlug: null };
    }

    let errorBody: { code?: string; message?: string } | null = null;
    try {
      errorBody = (await res.json()) as { code?: string; message?: string };
    } catch {
      errorBody = null;
    }
    return {
      ok: false,
      error: errorBody?.message ?? `Couldn't accept the invitation (HTTP ${res.status}).`,
    };
  });

export type RejectInvitationResult = { ok: true } | { ok: false; error: string };

export const rejectInvitation = createServerFn({ method: "POST" })
  .validator((data: { invitationId: string }) => data)
  .handler(async ({ data }): Promise<RejectInvitationResult> => {
    const res = await baeClient().fetch(
      new Request(`${GUESTLIST_INTERNAL}/api/auth/organization/reject-invitation`, {
        method: "POST",
        headers: { ...forwardHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ invitationId: data.invitationId }),
      }),
    );

    if (res.status === 200) return { ok: true };

    let errorBody: { code?: string; message?: string } | null = null;
    try {
      errorBody = (await res.json()) as { code?: string; message?: string };
    } catch {
      errorBody = null;
    }
    return {
      ok: false,
      error: errorBody?.message ?? `Couldn't decline the invitation (HTTP ${res.status}).`,
    };
  });
