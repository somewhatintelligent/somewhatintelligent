import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardHeader, CardTitle, CardContent } from "@si/ui/components/card";

export const Route = createFileRoute("/_auth/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Identity" },
      {
        name: "description",
        content: "What we store, why, and for how long. Spoiler: not much.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            This is a personal identity provider. It stores your email, your name if you give one, a
            hashed password, and session data. That is the inventory. There is no hidden annex.
          </p>
          <p>
            I might use your data for analytics or to improve services I build. I am not sure for
            what yet. But before I do, I will tell you. Currently, I do not. You should feel
            reasonably safe with that, and trust in my benevolence. This may be unwise, but you make
            many unwise decisions on the internet, and I am far less capable of harm to you than the
            technofeudal data empires you already subscribe to.
          </p>
          <p>
            If you sign in with a third-party provider — Google, Microsoft, whatever — that provider
            receives the fact that you authenticated here. What they do with that is between you and
            them. Similarly, if you authorize an application via OAuth, it receives whatever scopes
            you consented to. You can revoke that access at any time from your account.
          </p>
          <p>
            If you delete your account, your data is deleted. Not archived. Not soft-deleted.
            Deleted.
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
