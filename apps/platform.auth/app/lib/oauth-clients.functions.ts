import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";

export interface ConsentingClient {
  /** What the client calls itself, or `null` when it did not say. */
  readonly name: string | null;
  /**
   * Nobody this account can name registered it.
   *
   * The consent screen leads with `name`, and since registration is open that
   * string is chosen by whoever registered — including a stranger who picked
   * something reassuring. This is the one fact on the screen the client did not
   * get to choose, so it is what the warning is drawn from.
   *
   * `true` when the provenance lookup fails, too. An unknown client is not a
   * vouched-for one, and the safe direction for a warning is on.
   */
  readonly selfRegistered: boolean;
}

/**
 * What the consent screen falls back to when it cannot learn anything.
 *
 * THE SECURITY DEFAULT, exported so it is decided once. The warning exists for
 * the case where we cannot vouch for a client, and "the lookup broke" is such a
 * case — so an outage shows the warning rather than quietly removing it. A
 * caller writing this literal itself is a caller that can get it backwards.
 */
export const UNVOUCHED_CLIENT: ConsentingClient = { name: null, selfRegistered: true };

/**
 * The client, as the consent screen needs to describe it.
 *
 * BOTH FACTS TOGETHER, because they are read together and shown together: a
 * name with no provenance beside it is the phishing surface, so they should not
 * be separately fetchable and separately forgettable.
 *
 * Two calls rather than one, concurrently, so the wait is the slower of them
 * rather than the sum. They are not merged into a single row read on purpose:
 * `publicClientPrelogin` verifies the signed `oauth_query` before it will say
 * anything about a client, and reading the row directly would answer the same
 * question without that check.
 */
export const resolveConsentingClient = createServerFn({ method: "POST" })
  .validator((data: { client_id: string; oauth_query: string }) => data)
  .handler(async ({ data }): Promise<ConsentingClient> => {
    const client = baeClient();
    const [described, provenance] = await Promise.all([
      client.publicClientPrelogin({
        client_id: data.client_id,
        oauth_query: data.oauth_query,
      }),
      client.clientProvenance({ clientId: data.client_id }),
    ]);

    return {
      name: described.ok
        ? ((described.value as { client_name?: string }).client_name ?? null)
        : null,
      selfRegistered: provenance.ok ? provenance.selfRegistered : true,
    };
  });
