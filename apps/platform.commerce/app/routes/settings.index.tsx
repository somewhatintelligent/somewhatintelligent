/**
 * WHAT THIS DEPLOYMENT IS, and the one maintenance operation an operator runs
 * by hand.
 *
 * Nothing here is editable. The payment environment, the provider and the
 * identity are all decided by the deploy — a console that could change them
 * would be able to point a running shop at a different Stripe account, which is
 * not an operator decision. This page exists so those facts are checkable
 * before a launch rather than inferred from behaviour afterwards.
 *
 * THE SWEEP IS THE EXCEPTION, and it is safe because it is idempotent: it heals
 * orders whose webhook was lost by asking the provider what it actually knows,
 * and releases stock reserved by carts that were abandoned. It runs on a cron
 * every fifteen minutes regardless; the button is for not waiting.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";
import { Button } from "platform.ui/components/button";

import { Facts, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { paymentsProvider, runSweep, settlementProvider } from "../lib/admin.functions.ts";

type Settlement = Awaited<ReturnType<typeof settlementProvider>> | null;

export const Route = createFileRoute("/settings/")({
  loader: async () => {
    const [minting, settling] = await Promise.all([
      paymentsProvider().catch(() => null),
      settlementProvider().catch(() => null),
    ]);
    return { minting, settling };
  },
  component: Settings,
});

function Settings() {
  const { minting, settling } = Route.useLoaderData();
  const { actor, paymentsEnvironment, version } = Route.useRouteContext();

  return (
    <>
      <PageHeader title="Settings" subtitle="Fixed by the deploy. Shown so it can be checked." />

      <Warnings minting={minting} settling={settling} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Payments">
          <Facts
            rows={[
              ["Environment", paymentsEnvironment ?? "unknown"],
              ["Checkout mints with", minting ?? "unreadable"],
              ["Settlement settles with", settling?.kind ?? "unreadable"],
              ["Live mode", liveModeLabel(settling)],
            ]}
          />
          <Hint>
            The environment is derived from the deploy&rsquo;s stage name: <code>prod</code> is
            live, <code>preprod</code> and <code>staging</code> are the sandbox, everything else is
            dev.
          </Hint>
        </Section>

        <Section title="You">
          <Facts
            rows={[
              ["Email", actor?.email ?? "—"],
              ["Subject", actor?.sub ?? "—"],
              ["Build", version ? `${version.tag || "—"} ${version.id.slice(0, 8)}` : "dev"],
            ]}
          />
          <Hint>
            The subject is what every audit row and every idempotency key is namespaced by. Verified
            from the Cloudflare Access assertion on each request, never from the browser.
          </Hint>
        </Section>
      </div>

      <Reconcile />
    </>
  );
}

const liveModeLabel = (settling: Settlement): string =>
  settling === null ? "unreadable" : settling.livemode ? "yes" : "no";

/**
 * The two things worth interrupting someone about.
 *
 * A provider disagreement is the configuration mistake that takes money and
 * loses it; live mode is the one that makes every other button on the site
 * consequential. Neither is a state this page can fix, so both are stated
 * rather than offered as an action.
 */
function Warnings({ minting, settling }: { minting: string | null; settling: Settlement }) {
  const disagree = minting !== null && settling !== null && minting !== settling.kind;

  return (
    <>
      {disagree ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Checkout and settlement disagree</AlertTitle>
          <AlertDescription>
            Commerce mints sessions with <strong>{minting}</strong>, Settlement settles with{" "}
            <strong>{settling.kind}</strong>. A session minted by one cannot be settled by the other
            — a payment taken now succeeds at the provider and leaves its order pending/unpaid
            forever.
          </AlertDescription>
        </Alert>
      ) : null}

      {settling?.livemode ? (
        <Alert variant="warning">
          <AlertTitle>This deployment takes real money</AlertTitle>
          <AlertDescription>
            Settlement is in live mode. Every checkout on the storefront charges a real card.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function Reconcile() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [swept, setSwept] = useState<string | null>(null);

  const sweep = async () => {
    setBusy(true);
    setError(null);
    setSwept(null);
    try {
      setSwept(JSON.stringify(await runSweep()));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Reconcile"
      description="Heals lost webhooks and releases stock held by abandoned carts."
      actions={
        <Button variant="outline" onClick={() => void sweep()} disabled={busy}>
          <RefreshCw />
          {busy ? "Sweeping…" : "Run sweep now"}
        </Button>
      }
    >
      <Outcome error={error} done={swept ? `Swept — ${swept}` : null} />
      <Hint>
        The webhook answers 200 the moment an event is queued, which opts out of the
        provider&rsquo;s own multi-day retry — this sweep is what covers that. It runs on a cron
        every fifteen minutes; reach for the button when an order is stuck and you would rather not
        wait for the next tick.
      </Hint>
    </Section>
  );
}
