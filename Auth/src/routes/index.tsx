import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    // `to`-based so the redirect is mount-correct on both sides: SSR emits a
    // root-relative Location (bouncer prepends the /account vmf mount), the
    // client router navigates internally (the output rewrite writes the
    // mounted URL to the address bar). An `href` redirect is read in the
    // BROWSER frame instead — under the mount the string "/account" IS the
    // mount, gets input-stripped to "/", and this route redirects to itself
    // forever (each pass re-running root beforeLoad → loadSession).
    throw redirect({ to: context.session ? "/account" : "/sign-in" });
  },
});
