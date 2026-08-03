import * as Effect from "effect/Effect";
import type { EmailTemplatesService, MailService, Touchpoint } from "lib.better-auth-effect";

/**
 * Render a touchpoint and send it. The only place the two seams meet.
 *
 * Takes the services as VALUES rather than reaching for them inside the
 * returned effect, because both are resolved once when `authConfig` is built —
 * like `Origin` and `Signing` beside them — not per request. That keeps the
 * request boundary carrying `never`: nothing here needs a service to be alive
 * for the duration of a call, only the client it already holds.
 */
export const deliverWith =
  (mail: MailService, templates: EmailTemplatesService) =>
  (touchpoint: Touchpoint, to: string, variables: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const { subject, text, html } = yield* templates.render({ touchpoint, variables });
      yield* mail.send({ to: [to], subject, text, html });
    });
