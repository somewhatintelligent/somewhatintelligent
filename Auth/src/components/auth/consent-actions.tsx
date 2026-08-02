import { useState } from "react";
import { Button } from "@si/ui/components/button";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

export function ConsentActions() {
  const [error, setError] = useState<string | null>(null);

  async function handleConsent(accept: boolean) {
    setError(null);
    const res = await authClient.oauth2.consent({ accept });
    if (res.error) {
      setError(res.error.message ?? "Something went wrong");
      return;
    }
    if (res.data?.url) {
      window.location.href = res.data.url;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Button className="justify-center" onClick={() => handleConsent(true)}>
          Allow
        </Button>
        <Button variant="ghost" className="justify-center" onClick={() => handleConsent(false)}>
          Deny
        </Button>
      </div>
    </div>
  );
}
