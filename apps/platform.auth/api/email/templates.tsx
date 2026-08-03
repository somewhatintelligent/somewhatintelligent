import { Action, Code, Layout, Prose } from "./Layout.tsx";

/**
 * One component per Better Auth touchpoint that reaches a person by email.
 * `phone-otp` is absent on purpose — that is the `Sms` seam, not this one.
 *
 * VOICE, from the brand study: begin cleanly, make one unexpectedly exact
 * turn, end before the joke becomes a bit. Theory sharpens a material fact and
 * never perfumes it. Each email states what happened before it explains
 * itself, and each carries exactly one leak.
 *
 * These are auth's, not a shared package's. The previous repo kept six of them
 * in `@si/email` under a `guestlist/` directory — one app's templates, wearing
 * a namespace that admitted as much.
 */

export interface LinkProps {
  readonly origin: string;
  readonly url: string;
  readonly email: string;
  readonly expiresIn: string;
}

export interface CodeProps {
  readonly origin: string;
  readonly code: string;
  readonly email: string;
  readonly expiresIn: string;
}

export function VerifyEmail({ origin, url, email, expiresIn }: LinkProps) {
  return (
    <Layout
      origin={origin}
      title="Verify your address"
      preview="An account was opened with this address. Confirm it."
      heading="Verify address"
      leak={{ text: "identity is a claim someone else still has to accept." }}
      record={[
        { label: "Address", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        An account here was opened with this address. Confirming turns that claim into a fact the
        system will act on — until then it is only something someone typed.
      </Prose>
      <Prose>If it was not you, nothing has been created that you need to undo.</Prose>
      <Action href={url} label="Confirm address" />
    </Layout>
  );
}

export function MagicLink({ origin, url, email, expiresIn }: LinkProps) {
  return (
    <Layout
      origin={origin}
      title="Your sign-in link"
      preview="No password. One link, one use."
      heading="Sign in"
      leak={{ text: "one use. then it forgets you asked." }}
      record={[
        { label: "Address", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        No password. This link proves you control this inbox, which is the only thing the system was
        ever really checking. Passwords were a detour; this is the same fact, stated more honestly.
      </Prose>
      <Action href={url} label="Sign in" />
    </Layout>
  );
}

export function ResetPassword({ origin, url, email, expiresIn }: LinkProps) {
  return (
    <Layout
      origin={origin}
      title="Reset your password"
      preview="Someone asked to replace this account's password."
      heading="Reset password"
      leak={{ text: "a password is a secret you agreed to share with a database." }}
      record={[
        { label: "Account", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        Someone asked to replace the password on this account. If that was not you, nothing has
        happened yet — the existing password still works and this link expires on its own.
      </Prose>
      <Action href={url} label="Set a new password" />
    </Layout>
  );
}

export function ChangeEmail({ origin, url, email, expiresIn }: LinkProps) {
  return (
    <Layout
      origin={origin}
      title="Confirm your new address"
      preview="This account is moving to a new address."
      heading="Change address"
      leak={{ text: "history can be rewritten." }}
      record={[
        { label: "New address", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        This account is moving here. Confirming completes the move and retires the previous address
        — sign-in, recovery and every notice follow it immediately.
      </Prose>
      <Action href={url} label="Confirm the move" />
    </Layout>
  );
}

export function DeleteAccount({ origin, url, email, expiresIn }: LinkProps) {
  return (
    <Layout
      origin={origin}
      title="Confirm account deletion"
      preview="This will end the account and everything filed under it."
      heading="Delete account"
      leak={{ text: "the platform knows your name. for a few more minutes." }}
      record={[
        { label: "Account", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        This ends the account and everything filed under it. There is no undo, and no quiet archive
        copy held back on your behalf.
      </Prose>
      <Prose>If you did not ask for this, do nothing and the request expires.</Prose>
      <Action href={url} label="Delete permanently" destructive />
    </Layout>
  );
}

export function OrganizationInvitation({
  origin,
  url,
  organization,
  invitedBy,
  expiresIn,
}: {
  readonly origin: string;
  readonly url: string;
  readonly organization: string;
  readonly invitedBy: string;
  readonly expiresIn: string;
}) {
  return (
    <Layout
      origin={origin}
      title={`You have been added to ${organization}`}
      preview={`${invitedBy} added you to ${organization}.`}
      heading="Invitation"
      /* The house line, on the one email that is literally an offer of association. */
      leak={{ text: "I think we should be friends. In the C++ way." }}
      record={[
        { label: "Organization", value: organization },
        { label: "Invited by", value: invitedBy },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>
        {invitedBy} added you to {organization}. Accepting grants access to what that organization
        owns here — which is a real transfer of reach, not a notification.
      </Prose>
      <Action href={url} label="Accept invitation" />
    </Layout>
  );
}

export function EmailOtp({ origin, code, email, expiresIn }: CodeProps) {
  return (
    <Layout
      origin={origin}
      title="Your one-time code"
      preview="A code, good once."
      heading="One-time code"
      leak={{ text: "six digits, and a short opinion about who you are." }}
      record={[
        { label: "Address", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>Enter this where you started. It works once, and only on that screen.</Prose>
      <Code code={code} />
      <Prose>If you did not ask for a code, someone has your address and nothing else.</Prose>
    </Layout>
  );
}

export function TwoFactorOtp({ origin, code, email, expiresIn }: CodeProps) {
  return (
    <Layout
      origin={origin}
      title="Your second factor"
      preview="A code to finish signing in."
      heading="Second factor"
      /* Lifted from the account/security mockup, where it is handwritten in pink. */
      leak={{ text: "security is a form of authorship." }}
      record={[
        { label: "Account", value: email },
        { label: "Expires", value: expiresIn },
      ]}
    >
      <Prose>A password got someone this far. This code decides whether that someone is you.</Prose>
      <Code code={code} />
      <Prose>
        If you were not signing in, the password on this account is known to someone else. Change
        it.
      </Prose>
    </Layout>
  );
}
