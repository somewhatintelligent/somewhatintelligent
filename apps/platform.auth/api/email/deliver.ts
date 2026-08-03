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
  (mail: MailService, templates: EmailTemplatesService, origin: string) =>
  (touchpoint: Touchpoint, to: string, variables: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      /**
       * `origin` is injected rather than asked for: the templates service would
       * otherwise need `Origin` in its requirement channel, and sibling layers
       * in `live` do not provide each other. It is also the same origin Better
       * Auth minted the link with, so the footer cannot advertise a different
       * deployment than the button points at.
       */
      const { subject, text, html } = yield* templates.render({
        touchpoint,
        variables: { origin, ...variables },
      });
      yield* mail.send({ to: [to], subject, text, html });
    });
