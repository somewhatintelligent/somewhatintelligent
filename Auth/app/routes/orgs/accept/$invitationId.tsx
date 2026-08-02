import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  InvitationAcceptCard,
  type InvitationCardState,
} from "@/components/orgs/invitation-accept-card";
import { authClient } from "@/lib/auth-client";
import {
  acceptInvitation,
  getInvitationForAccept,
  rejectInvitation,
  type InvitationFetchResult,
} from "@/lib/invitation.functions";

/**
 * Public landing page for organization invitations. Surfaces one of four
 * top-level UI branches based on the caller's session + BA's response to
 * `getInvitation`:
 *
 *  1. Not signed in    — invite the user to sign in / sign up.
 *  2. Valid invitation — show org name, role, accept / decline.
 *  3. Wrong email      — prompt sign-out (so the user can re-auth as the invitee).
 *  4. Unavailable      — expired / cancelled / already accepted / unknown id.
 *
 * BA's `getInvitation` requires a session, so the loader returns the
 * discriminated `InvitationFetchResult` shape — no extra round-trip is
 * needed to decide which branch to render.
 */
export const Route = createFileRoute("/orgs/accept/$invitationId")({
  loader: ({ params }) => getInvitationForAccept({ data: { invitationId: params.invitationId } }),
  head: () => ({ meta: [{ title: "Accept Invitation — Identity" }] }),
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { invitationId } = Route.useParams();
  const fetchResult = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const state: InvitationCardState = deriveCardState(fetchResult, invitationId);

  async function handleAccept() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await acceptInvitation({ data: { invitationId } });
      if (!res.ok) {
        setErrorMessage(res.error);
        setSubmitting(false);
        return;
      }
      // TODO(O-11+): once `/orgs/:slug` exists and we plumb the slug
      // through the accept response, redirect there instead of `/`. For
      // now BA sets the new org active on the session and `/` lands the
      // user on the dashboard with that context.
      await router.invalidate();
      await navigate({ to: "/" });
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Couldn't accept the invitation.");
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await rejectInvitation({ data: { invitationId } });
      if (!res.ok) {
        setErrorMessage(res.error);
        setSubmitting(false);
        return;
      }
      await router.invalidate();
      await navigate({ to: "/" });
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Couldn't decline the invitation.");
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await authClient.signOut();
      // Reload the same URL so the loader re-runs and renders the
      // "not-signed-in" branch (prompting the user to sign in with the
      // right account).
      await router.invalidate();
      window.location.reload();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Couldn't sign you out.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <InvitationAcceptCard
          state={state}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onSignOut={handleSignOut}
          errorMessage={errorMessage}
          submitting={submitting}
        />
      </div>
    </main>
  );
}

function deriveCardState(fetch: InvitationFetchResult, invitationId: string): InvitationCardState {
  switch (fetch.kind) {
    case "no-session":
      return { kind: "not-signed-in", invitationId };
    case "ok": {
      const inv = fetch.invitation;
      // Inviter display name isn't on BA's `getInvitation` response; fall
      // back to the email so the copy still reads naturally.
      const inviterName = inv.inviterName ?? inv.inviterEmail;
      return {
        kind: "valid",
        orgName: inv.organizationName,
        inviterName,
        inviterEmail: inv.inviterEmail,
        role: inv.role,
      };
    }
    case "wrong-recipient":
      return {
        kind: "wrong-email",
        // BA's 403 response doesn't expose the invitee email (privacy).
        inviteeEmail: null,
        userEmail: fetch.sessionUserEmail,
      };
    case "email-unverified":
      return { kind: "email-unverified", userEmail: fetch.sessionUserEmail };
    case "not-available":
      return { kind: "not-found" };
  }
}
