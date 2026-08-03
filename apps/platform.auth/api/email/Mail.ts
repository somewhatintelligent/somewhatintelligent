import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Mail, MailError, type MailMessage } from "lib.better-auth-effect";
import { PRODUCTION_ZONE } from "platform.names";

/**
 * `MailService` over Cloudflare Email Service's Workers binding.
 *
 * TWO DIFFERENT THINGS ARE CALLED `send_email`. The older Email Routing binding
 * takes a raw MIME `EmailMessage` and reaches only destination addresses
 * verified on the account — useless for a stranger who just signed up. Email
 * Service's binding takes a structured message and, once a sending domain is
 * onboarded, delivers to any recipient. This is the second one, and
 * `apps/platform.inbox/workers/email-sender.ts` is the same product already in
 * production.
 *
 * `somewhatintelligent.ca` IS ALREADY ONBOARDED to Email Sending, and
 * `hello@` is already the sender it was onboarded for — see the old repo's
 * `workers/promoter/wrangler.jsonc`, which has run `{ kind: "cloudflare",
 * binding: env.EMAIL }` against it in production. Nothing needs provisioning
 * here; the previous auth worker simply never used it, sending through Resend
 * instead while its sibling used the binding.
 */

/** The descriptor the worker binds. Unrestricted: auth mails strangers. */
export const AuthEmail = Cloudflare.Email.SendEmail("EMAIL");

/**
 * Carried over from the old repo's production `EMAIL_FROM`, display name and
 * all. `hello@` is also the brand's support address, which is the point: a
 * reply to an account email should reach a person rather than a void.
 *
 * The address must sit on a domain onboarded to Email Sending or every send is
 * refused. Lowercase display name — the brand takes capitals only in the
 * institutional register, and this is the from-line, not a garment label.
 */
const FROM = { email: `hello@${PRODUCTION_ZONE}`, name: "somewhatintelligent" };

export const mail = Effect.gen(function* () {
  const client = yield* Cloudflare.Email.Send(yield* AuthEmail);

  return Mail.of({
    /**
     * `MailError` rather than a defect, because a refused send is a FAILURE the
     * caller can answer — Better Auth turns it into an API error the person
     * sees, rather than a 500 that tells them nothing. A broken template is the
     * defect; see `render.tsx`.
     */
    send: (message: MailMessage) =>
      client
        .send({
          from: FROM,
          to: [...message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) => new MailError(cause instanceof Error ? cause.message : String(cause)),
          ),
          /**
           * Discharge `RuntimeContext`. It is present when the Worker runs but
           * absent from `MailService`, whose `send` is declared with no
           * requirement — the same discharge the D1 connection uses in
           * `capabilities.ts`.
           */
          (send) => Effect.provide(send, RuntimeContext.phantom),
        ),
  });
});
