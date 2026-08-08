/**
 * What `oauth_client.reference_id` MEANS, in the one place that decides it.
 *
 * The column is the plugin's slot for "something other than a user owns this
 * client" — it is set from `clientReference`, which this deployment does not
 * configure, so nothing writes it at registration. What does carry a value is
 * the managed clients this account provisions, prefixed so they are
 * recognisable.
 *
 * In `shared/` because two surfaces read it and they must not disagree: the
 * admin console badges a managed client, and the consent screen decides from
 * the same column whether anyone has vouched for the client it is about to name
 * (see `clientProvenance` in `api/rpc.ts`). A second reading of one column is
 * how those two end up telling a person different things about the same client.
 */

const MANAGED_PREFIX = "managed:";

export function isManaged(referenceId: string | null | undefined): boolean {
  return referenceId?.startsWith(MANAGED_PREFIX) ?? false;
}
