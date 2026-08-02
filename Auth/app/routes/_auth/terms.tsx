import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardHeader, CardTitle, CardContent } from "@si/ui/components/card";

export const Route = createFileRoute("/_auth/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Identity" },
      {
        name: "description",
        content: "The rules. Short, readable, and mildly threatening.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <>
      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardHeader>
          <CardTitle>Terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            You are using a personal identity provider operated by one person. Don't abuse it. If
            your account causes problems, it will cease to exist. This service is provided as-is. It
            will probably work. If it doesn't, the remedies available to you are: waiting, or
            sending a polite email.
          </p>
          <p>
            Your data is yours. You can delete it at any time. See the{" "}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
              privacy policy
            </Link>{" "}
            for what we store and on what terms.
          </p>
          <p>
            These terms may change. If they do, it will be because something genuinely needed
            changing.
          </p>
        </CardContent>
      </Card>

      <div className="mt-section flex justify-center text-xs text-muted-foreground/80">
        <Link to="/sign-in" className="hover:text-muted-foreground">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
