import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_device/device")({
  head: () => ({ meta: [{ title: "Device — Identity" }] }),
  component: DevicePage,
});

function DevicePage() {
  const navigate = useNavigate();
  const [userCode, setUserCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function sanitize(raw: string): string {
    return raw
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase()
      .slice(0, 8);
  }

  function formatDisplay(code: string): string {
    return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await authClient.device({
        query: { user_code: userCode },
      });

      if (response.data) {
        void navigate({ to: `/device/approve?user_code=${userCode}` });
      } else {
        setError("Invalid or expired code. The device may have moved on without you.");
      }
    } catch {
      setError("Invalid or expired code. The device may have moved on without you.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mb-section text-center">
        <div className="type-display-title">Device</div>
        <div className="type-editorial-lede mt-grid text-muted-foreground">
          Enter the code displayed on your device. It knows what it means, even if you do not.
        </div>
      </div>

      <Card className="p-page">
        <CardContent className="space-y-0 p-0">
          <form method="post" className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div>
              <Label
                htmlFor="user-code"
                className="type-mono-label mb-2 block text-muted-foreground/80"
              >
                Device Code
              </Label>
              <Input
                id="user-code"
                type="text"
                value={formatDisplay(userCode)}
                onChange={(e) => setUserCode(sanitize(e.target.value))}
                placeholder="XXXX-XXXX"
                maxLength={9}
                className="text-center font-mono text-lg tracking-widest"
                autoComplete="off"
                autoFocus
              />
            </div>

            {error && <Alert variant="destructive">{error}</Alert>}

            <Button
              type="submit"
              size="lg"
              className="w-full justify-center"
              disabled={loading || userCode.length < 8}
            >
              {loading ? "Verifying\u2026" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
