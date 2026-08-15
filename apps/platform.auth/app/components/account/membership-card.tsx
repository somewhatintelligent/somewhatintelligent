/**
 * The billing surface, and a worked example of the entitlement abstraction.
 *
 * READ WHAT IT DOES NOT DO. It never asks "is this person a patron". It renders
 * the tier because a tier is a thing a human buys and wants to see the name of —
 * and it renders the CAPABILITIES by iterating the catalogue, so a capability
 * added next week appears here, with its label, with no edit to this file.
 * Everywhere a decision is made rather than displayed, the question is a
 * capability.
 *
 * The grant reaching a browser is a rendering input, never an authorisation. The
 * server function that produced it is the same one a mutation re-runs.
 */
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CheckIcon, MinusIcon } from "lucide-react";
import {
  allows,
  ENTITLEMENTS,
  isQuotaKey,
  limitOf,
  TIERS,
  type EntitlementKey,
  type Entitlements,
  type MembershipStatus,
  type Quota,
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
 * The statuses worth showing, with their tone and their wording in one entry.
 *
 * PARTIAL, deliberately: `live` is the membership that is currently granting, so
 * only these three can reach here, and a status with no entry renders no badge
 * rather than a badge saying `incomplete_expired`.
 */
const STATUS_BADGE: Partial<
  Record<MembershipStatus, { readonly tone: "success" | "warning"; readonly label: string }>
> = {
  active: { tone: "success", label: "Active" },
  trialing: { tone: "success", label: "Trial" },
  past_due: { tone: "warning", label: "Payment failed — retrying" },
};

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
 * package because it is a rendering decision — the package already models the
 * difference, and `String(value)` would print `true`.
 */
function EntitlementRow({
  entitlements,
  entitlementKey,
}: {
  entitlements: Entitlements;
  entitlementKey: EntitlementKey;
}) {
  return (
    <Item variant="surface" size="sm">
      <ItemContent>
        <ItemTitle>{ENTITLEMENTS[entitlementKey].label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {isQuotaKey(entitlementKey) ? (
          <QuotaBadge limit={limitOf(entitlements, entitlementKey)} />
        ) : allows(entitlements, entitlementKey) ? (
          <CheckIcon className="size-4" aria-label="included" />
        ) : (
          <MinusIcon className="size-4 opacity-50" aria-label="not included" />
        )}
      </ItemActions>
    </Item>
  );
}

function QuotaBadge({ limit }: { limit: Quota }) {
  return (
    <Badge variant={limit === 0 ? "outline" : "secondary"} size="sm">
      {limit === "unlimited" ? "Unlimited" : String(limit)}
    </Badge>
  );
}

export function MembershipCard({ view }: { view: MembershipView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const tier = TIERS[view.grant.tier];
  const { live } = view;
  const badge = live === null ? undefined : STATUS_BADGE[live.status];
  const renews = dateLabel(live?.periodEnd ?? null);

  const upgrade = async (plan: TierId) => {
    setBusy(true);
    const { error } = await authClient.subscription.upgrade({
      plan,
      successUrl: "/account",
      cancelUrl: "/account",
      // The Stripe subscription being replaced. REQUIRED when one is already
      // running — without it the plugin opens a second checkout and the customer
      // ends up billed for both.
      ...(view.stripeSubscriptionId === null ? {} : { subscriptionId: view.stripeSubscriptionId }),
    });
    setBusy(false);
    if (error) toast.error(error.message ?? "Could not open checkout");
  };

  const portal = async () => {
    setBusy(true);
    const { error } = await authClient.subscription.billingPortal({ returnUrl: "/account" });
    setBusy(false);
    if (error) toast.error(error.message ?? "Could not open the billing portal");
    else await router.invalidate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            {tier.title}
            {badge !== undefined && (
              <Badge variant={badge.tone} size="sm">
                {badge.label}
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
          <>
            {!view.webhooksVerifiable && (
              <ItemDescription>
                This stage cannot verify Stripe webhooks, so a completed payment will not activate a
                subscription here. Checkout still opens, against the test account.
              </ItemDescription>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {(Object.entries(TIERS) as ReadonlyArray<[TierId, (typeof TIERS)[TierId]]>)
                .filter(([id, candidate]) => candidate.purchasable && id !== view.grant.tier)
                .map(([id, candidate]) => {
                  const isUpgrade = candidate.rank > tier.rank;
                  return (
                    <Button
                      key={id}
                      variant={isUpgrade ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => void upgrade(id)}
                    >
                      {isUpgrade ? `Upgrade to ${candidate.title}` : `Switch to ${candidate.title}`}
                    </Button>
                  );
                })}
              {live !== null && (
                <Button variant="outline" disabled={busy} onClick={() => void portal()}>
                  Manage billing
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
