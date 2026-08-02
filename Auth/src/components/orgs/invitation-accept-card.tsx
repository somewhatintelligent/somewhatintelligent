import { Link } from "@tanstack/react-router";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { GuestlistBrand } from "@/components/guestlist-brand";

/**
 * Visual states the `/orgs/accept/:invitationId` route can render.
 *
 * The kinds are kept granular (separate `expired` / `cancelled` /
 * `already-accepted` etc.) so future refinements that gain visibility
 * into BA's underlying invitation status can render a more specific
 * message without changing this component's prop shape. The current
 * server fn collapses BA's 400 "Invitation not found!" response into the
 * `not-found` kind because BA doesn't distinguish those cases.
 */
export type InvitationCardState =
  | { kind: "not-signed-in"; invitationId: string }
  | {
      kind: "valid";
      orgName: string;
      inviterName: string;
      inviterEmail: string;
      role: string;
    }
  | { kind: "wrong-email"; inviteeEmail: string | null; userEmail: string }
  | { kind: "email-unverified"; userEmail: string }
  | { kind: "expired"; expiresAt: string; inviterName: string }
  | { kind: "cancelled"; inviterName: string }
  | { kind: "already-accepted" }
  | { kind: "not-found" };

export interface InvitationAcceptCardProps {
  state: InvitationCardState;
  /** Bound to the route's `acceptInvitation` server-fn call. */
  onAccept?: () => void;
  /** Bound to the route's `rejectInvitation` server-fn call. */
  onDecline?: () => void;
  /** Bound to `authClient.signOut()` + reload of the same invitation URL. */
  onSignOut?: () => void;
  /** Surfaced when accept/decline calls fail; rendered inline below the buttons. */
  errorMessage?: string | null;
  /** Disables action buttons during in-flight server-fn calls. */
  submitting?: boolean;
}

export function InvitationAcceptCard({
  state,
  onAccept,
  onDecline,
  onSignOut,
  errorMessage,
  submitting,
}: InvitationAcceptCardProps) {
  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardBody
          state={state}
          onAccept={onAccept}
          onDecline={onDecline}
          onSignOut={onSignOut}
          errorMessage={errorMessage}
          submitting={submitting}
        />
      </Card>
    </>
  );
}

function CardBody({
  state,
  onAccept,
  onDecline,
  onSignOut,
  errorMessage,
  submitting,
}: InvitationAcceptCardProps) {
  switch (state.kind) {
    case "not-signed-in":
      return (
        <>
          <CardHeader>
            <CardTitle>You've been invited.</CardTitle>
            <CardDescription>
              You've been invited to join an organization. Sign in to accept.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <Link
              to="/sign-in"
              search={{ returnTo: `/orgs/accept/${state.invitationId}` }}
              className="contents"
            >
              <Button size="lg" className="w-full justify-center">
                Sign in to accept
              </Button>
            </Link>
            <Link
              to="/sign-up"
              search={{ returnTo: `/orgs/accept/${state.invitationId}` }}
              className="contents"
            >
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Create an account instead
              </Button>
            </Link>
          </CardContent>
        </>
      );

    case "valid":
      return (
        <>
          <CardHeader>
            <CardTitle>Join {state.orgName}?</CardTitle>
            <CardDescription>
              <strong className="text-foreground">{state.inviterName}</strong> invited you as{" "}
              <strong className="text-foreground">{state.role}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 pt-2">
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>You'll be a member of {state.orgName}'s workspace.</li>
              <li>{state.inviterName} can adjust your role at any time.</li>
              <li>You can leave the organization from your account settings.</li>
            </ul>
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full justify-center"
                disabled={submitting}
                onClick={() => onAccept?.()}
              >
                {submitting ? "Working…" : "Accept invitation"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-center"
                disabled={submitting}
                onClick={() => onDecline?.()}
              >
                Decline
              </Button>
            </div>
            {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}
          </CardContent>
        </>
      );

    case "wrong-email":
      return (
        <>
          <CardHeader>
            <CardTitle>Wrong account.</CardTitle>
            <CardDescription>
              {state.inviteeEmail ? (
                <>
                  This invitation was sent to{" "}
                  <strong className="text-foreground">{state.inviteeEmail}</strong>. You're signed
                  in as <strong className="text-foreground">{state.userEmail}</strong>.
                </>
              ) : (
                <>
                  This invitation was sent to a different email address. You're signed in as{" "}
                  <strong className="text-foreground">{state.userEmail}</strong>.
                </>
              )}{" "}
              Sign out and sign in with the right account?
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <Button
              size="lg"
              className="w-full justify-center"
              disabled={submitting}
              onClick={() => onSignOut?.()}
            >
              {submitting ? "Signing out…" : "Sign out"}
            </Button>
            <Link to="/" className="contents">
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Go home
              </Button>
            </Link>
            {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}
          </CardContent>
        </>
      );

    case "email-unverified":
      return (
        <>
          <CardHeader>
            <CardTitle>Verify your email first.</CardTitle>
            <CardDescription>
              Before you can accept this invitation, verify your email address. We sent a
              verification link to <strong className="text-foreground">{state.userEmail}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <Link to="/account" className="contents">
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Go to account settings
              </Button>
            </Link>
          </CardContent>
        </>
      );

    case "expired":
      return (
        <>
          <CardHeader>
            <CardTitle>Invitation expired.</CardTitle>
            <CardDescription>
              This invitation expired on{" "}
              <strong className="text-foreground">{state.expiresAt}</strong>. Ask{" "}
              {state.inviterName} for a new invitation.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Link to="/" className="contents">
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Go home
              </Button>
            </Link>
          </CardContent>
        </>
      );

    case "cancelled":
      return (
        <>
          <CardHeader>
            <CardTitle>Invitation cancelled.</CardTitle>
            <CardDescription>
              This invitation was cancelled. Ask {state.inviterName} if you should have one.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Link to="/" className="contents">
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Go home
              </Button>
            </Link>
          </CardContent>
        </>
      );

    case "already-accepted":
      return (
        <>
          <CardHeader>
            <CardTitle>Already accepted.</CardTitle>
            <CardDescription>
              You already accepted this invitation. Head to your home page to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Link to="/" className="contents">
              <Button size="lg" className="w-full justify-center">
                Go home
              </Button>
            </Link>
          </CardContent>
        </>
      );

    case "not-found":
      return (
        <>
          <CardHeader>
            <CardTitle>Invitation not found.</CardTitle>
            <CardDescription>
              This invitation isn't available — it may have expired, been cancelled, or already been
              used. Check the link and try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Link to="/" className="contents">
              <Button variant="ghost" size="lg" className="w-full justify-center">
                Go home
              </Button>
            </Link>
          </CardContent>
        </>
      );
  }
}
