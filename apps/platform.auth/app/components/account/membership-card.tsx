/**
 * The billing surface, and a worked example of the entitlement abstraction.
 *
 * READ WHAT IT DOES NOT DO. It never asks "is this person a patron". It renders
 * the tier because a tier is a thing a human buys and wants to see the name of —
 * and it renders the CAPABILITIES by iterating the catalogue, so a capability
 * added next week appears here with no edit to this file. Everywhere a decision
 * is made rather than displayed, the question is a capability.
 *
 * The grant reaching a browser is a rendering input, never an authorisation. The
 * server function that produced it is the same one a mutation re-runs.
 */
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CheckIcon, MinusIcon } from "lucide-react";
import {
  ENTITLEMENTS,
  TIERS,
  type EntitlementKey,
  type Entitlements,
  type Membership,
  type TierId,
} from "platform.entitlements";
import { Badge } from "platform.ui/components/badge";
import { Button } from "platform.ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "platform.ui/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "platform.ui/components/item";
import { toast } from "platform.ui/components/sonner";

import { authClient } from "@/lib/auth-client";
import type { MembershipView } from "@/lib/billing.functions";

/**
 * How a capability reads to a person. The keys are the platform's vocabulary and
 * the labels are the product's, so this map is the one place they meet — and a
 * key with no entry renders as the key, which is ugly on purpose.
 */
const LABELS: Record<EntitlementKey, string> = {
  "systems.mezedes": "Mezedes",
  "systems.earlyAccess": "Systems in private alpha",
  "mezedes.mezes": "Mezes",
  "mezedes.serverCode": "Server-side code in a mezes",
};

const STATUS_TONE = {
  active: "success",
  trialing: "success",
  past_due: "warning",
} as const;

const statusLabel = (membership: Membership): string =>
  membership.status === "past_due"
    ? "Payment failed — retrying"
    : membership.status === "trialing"
      ? "Trial"
      : membership.status.replaceAll("_", " ");

const dateLabel = (at: number | null): string | null =>
  at === null
    ? null
    : new Date(at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

/**
 * A quota reads as a number, a flag as a tick. Split here rather than in the
 * package because it is a rendering decision: the package already models the
 * difference, and `String(value)` would print `true`.
 */
function EntitlementRow({
  entitlements,
  entitlementKey,
}: {
  entitlements: Entitlements;
  entitlementKey: EntitlementKey;
}) {
  const value = entitlements[entitlementKey];
  const held = value !== false && value !== 0;

  return (
    <Item variant="surface" size="sm">
      <ItemContent>
        <ItemTitle>{LABELS[entitlementKey] ?? entitlementKey}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {ENTITLEMENTS[entitlementKey] === "quota" ? (
          <Badge variant={held ? "secondary" : "outline"} size="sm">
            {value === "unlimited" ? "Unlimited" : String(value)}
          </Badge>
        ) : held ? (
          <CheckIcon className="size-4" aria-label="included" />
        ) : (
          <MinusIcon className="size-4 opacity-50" aria-label="not included" />
        )}
      </ItemActions>
    </Item>
  );
}

export function MembershipCard({ view }: { view: MembershipView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const tier = TIERS[view.grant.tier];
  const live = view.memberships.find((membership) => membership.status !== "canceled") ?? null;

  const upgrade = async (plan: TierId) => {
    setBusy(plan);
    const { error } = await authClient.subscription.upgrade({
      plan,
      successUrl: "/account",
      cancelUrl: "/account",
      // The Stripe subscription being replaced. REQUIRED when one is already
      // running — without it the plugin opens a second checkout and the customer
      // ends up billed for both.
      ...(view.stripeSubscriptionId === null ? {} : { subscriptionId: view.stripeSubscriptionId }),
    });
    setBusy(null);
    if (error) toast.error(error.message ?? "Could not open checkout");
  };

  const portal = async () => {
    setBusy("portal");
    const { error } = await authClient.subscription.billingPortal({ returnUrl: "/account" });
    setBusy(null);
    if (error) toast.error(error.message ?? "Could not open the billing portal");
    else await router.invalidate();
  };

  const renews = dateLabel(live?.periodEnd ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            {tier.title}
            {live !== null && live.status in STATUS_TONE && (
              <Badge variant={STATUS_TONE[live.status as keyof typeof STATUS_TONE]} size="sm">
                {statusLabel(live)}
              </Badge>
            )}
          </span>
        </CardTitle>
        <CardDescription>
          {tier.summary}
          {renews !== null &&
            (live?.cancelAtPeriodEnd === true ? ` Ends ${renews}.` : ` Renews ${renews}.`)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-grid">
        <ItemGroup>
          {(Object.keys(ENTITLEMENTS) as ReadonlyArray<EntitlementKey>).map((key) => (
            <EntitlementRow key={key} entitlements={view.grant.entitlements} entitlementKey={key} />
          ))}
        </ItemGroup>

        {!view.billing ? (
          <ItemDescription>
            Subscriptions are switched off on this deployment — it holds no Stripe credentials.
          </ItemDescription>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {(Object.entries(TIERS) as ReadonlyArray<[TierId, (typeof TIERS)[TierId]]>)
              .filter(([id, candidate]) => candidate.purchasable && id !== view.grant.tier)
              .map(([id, candidate]) => (
                <Button
                  key={id}
                  variant={candidate.rank > tier.rank ? "default" : "outline"}
                  disabled={busy !== null}
                  onClick={() => void upgrade(id)}
                >
                  {candidate.rank > tier.rank
                    ? `Upgrade to ${candidate.title}`
                    : `Switch to ${candidate.title}`}
                </Button>
              ))}
            {live !== null && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void portal()}>
                Manage billing
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
