import { render } from "@react-email/render";
import { EmailTemplates, type RenderedMail, type Touchpoint } from "lib.better-auth-effect";
import * as Effect from "effect/Effect";

import {
  ChangeEmail,
  DeleteAccount,
  EmailOtp,
  MagicLink,
  OrganizationInvitation,
  ResetPassword,
  TwoFactorOtp,
  VerifyEmail,
} from "./templates.tsx";

/**
 * `Touchpoint` → rendered mail, and the only place a template is chosen.
 *
 * `EmailTemplatesService.render` has NO error channel, which is a claim this
 * file has to make good on: a template is a pure function of its variables, so
 * a missing one falls back rather than failing. The subject lines live here
 * beside the component instead of inside it — the subject is the claim made in
 * the client's list view, and it should be readable next to its siblings.
 */

/** A variable that was expected and absent. Never blank — blank reads as a bug. */
const read = (vars: Readonly<Record<string, string>>, key: string, fallback: string): string =>
  vars[key] ?? fallback;

const UNKNOWN = "—";
const DEFAULT_EXPIRY = "shortly";

interface Rendered {
  readonly subject: string;
  readonly element: React.ReactElement;
}

interface Fields {
  readonly origin: string;
  readonly url: string;
  readonly email: string;
  readonly code: string;
  readonly expiresIn: string;
  readonly organization: string;
  readonly invitedBy: string;
}

/**
 * A TABLE, not a switch. `Record<Touchpoint, …>` is exhaustive by TYPE, so
 * adding a touchpoint upstream fails to compile here — the same guarantee a
 * `switch` gives through control flow, without ten branches of cyclomatic
 * complexity for what is really a lookup.
 *
 * `null` means "not deliverable as email". Only `phone-otp` is, and it is SMS:
 * reaching it means a phone touchpoint was wired to the mail seam instead of
 * `Sms`, which is a configuration defect rather than a delivery failure.
 */
const TEMPLATES: Record<Touchpoint, ((f: Fields) => Rendered) | null> = {
  "verify-email": (f) => ({
    subject: "Verify your address",
    element: <VerifyEmail origin={f.origin} url={f.url} email={f.email} expiresIn={f.expiresIn} />,
  }),
  "magic-link": (f) => ({
    subject: "Your sign-in link",
    element: <MagicLink origin={f.origin} url={f.url} email={f.email} expiresIn={f.expiresIn} />,
  }),
  "reset-password": (f) => ({
    subject: "Reset your password",
    element: (
      <ResetPassword origin={f.origin} url={f.url} email={f.email} expiresIn={f.expiresIn} />
    ),
  }),
  "change-email": (f) => ({
    subject: "Confirm your new address",
    element: <ChangeEmail origin={f.origin} url={f.url} email={f.email} expiresIn={f.expiresIn} />,
  }),
  "delete-account": (f) => ({
    subject: "Confirm account deletion",
    element: (
      <DeleteAccount origin={f.origin} url={f.url} email={f.email} expiresIn={f.expiresIn} />
    ),
  }),
  "organization-invitation": (f) => ({
    subject: `You have been added to ${f.organization}`,
    element: (
      <OrganizationInvitation
        origin={f.origin}
        url={f.url}
        organization={f.organization}
        invitedBy={f.invitedBy}
        expiresIn={f.expiresIn}
      />
    ),
  }),
  "email-otp": (f) => ({
    subject: "Your one-time code",
    element: <EmailOtp origin={f.origin} code={f.code} email={f.email} expiresIn={f.expiresIn} />,
  }),
  "two-factor-otp": (f) => ({
    subject: "Your second factor",
    element: (
      <TwoFactorOtp origin={f.origin} code={f.code} email={f.email} expiresIn={f.expiresIn} />
    ),
  }),
  "phone-otp": null,
};

const fields = (vars: Readonly<Record<string, string>>): Fields => ({
  origin: read(vars, "origin", ""),
  url: read(vars, "url", ""),
  email: read(vars, "email", UNKNOWN),
  code: read(vars, "otp", read(vars, "code", UNKNOWN)),
  expiresIn: read(vars, "expiresIn", DEFAULT_EXPIRY),
  organization: read(vars, "organization", "an organization"),
  invitedBy: read(vars, "invitedBy", "Someone"),
});

export const templates = Effect.gen(function* () {
  return EmailTemplates.of({
    render: ({ touchpoint, variables }) =>
      Effect.gen(function* () {
        const template = TEMPLATES[touchpoint];
        if (template === null) {
          return yield* Effect.die(
            new Error(
              `"${touchpoint}" is an SMS touchpoint and has no email template. ` +
                `Provide it through the Sms service instead of Mail.`,
            ),
          );
        }
        /**
         * Both renders come off the same element, so the plain-text part can
         * never describe a different email than the HTML — which is the usual
         * way a text fallback goes stale.
         */
        const chosen = template(fields(variables));
        const html = yield* Effect.promise(() => render(chosen.element));
        const text = yield* Effect.promise(() => render(chosen.element, { plainText: true }));
        return { subject: chosen.subject, text, html } satisfies RenderedMail;
      }),
  });
});
