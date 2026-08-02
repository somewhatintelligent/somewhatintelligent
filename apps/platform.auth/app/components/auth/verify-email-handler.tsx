import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "platform.ui/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "platform.ui/components/card";
import { Brand } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailHandler({ token, returnTo }: { token: string; returnTo?: string }) {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    void authClient.verifyEmail({ query: { token } }).then((result) => {
      setStatus(result.error ? "error" : "success");
    });
  }, [token]);

  return (
    <>
      <Brand className="mb-section flex flex-col items-center text-center" />

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        {status === "loading" && (
          <CardHeader>
            <CardTitle>Verifying{"\u2026"}</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        )}

        {status === "success" && (
          <>
            <CardHeader>
              <CardTitle>Verified.</CardTitle>
              <CardDescription>
                Your email is confirmed. You exist, at least as far as this system is concerned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a href={returnTo ?? "/account"} className="block">
                <Button className="w-full justify-center py-3.5">Continue</Button>
              </a>
            </CardContent>
          </>
        )}

        {status === "error" && (
          <>
            <CardHeader>
              <CardTitle className="text-destructive">Verification failed.</CardTitle>
              <CardDescription>
                The token is invalid or expired. You'll need to request a new one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/sign-in" className="block">
                <Button variant="secondary" className="w-full justify-center py-3.5">
                  Back to sign in
                </Button>
              </Link>
            </CardContent>
          </>
        )}
      </Card>
    </>
  );
}
