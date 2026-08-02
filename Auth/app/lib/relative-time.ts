/**
 * Tiny relative-time formatter for the admin org UI. Identity doesn't carry
 * `date-fns` as a dependency, and this is the only consumer for now, so we
 * inline the obvious approximation rather than pulling in a package.
 *
 * Returns "just now", "X minutes ago", "X hours ago", "X days ago", or a
 * locale date for >30d.
 */
export function relativeTime(input: string | number | Date | null | undefined): string {
  if (input == null) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) {
    // Future date (used for invitation expiry). Express as "in X days".
    return `in ${relativeMagnitude(-diffMs)}`;
  }
  if (diffMs < 60_000) return "just now";
  return `${relativeMagnitude(diffMs)} ago`;
}

function relativeMagnitude(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"}`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"}`;
  const date = new Date(Date.now() - ms);
  return date.toLocaleDateString("en-US");
}
