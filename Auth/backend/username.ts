/** Better Auth's own defaults for the `username` plugin. */
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;

/**
 * The username implied by an address, or `null` when there isn't one.
 *
 * The plugin's default validator accepts alphanumerics and underscores only,
 * so every separator a real address uses — `luke.c.foley`, `jada+tag` — has to
 * be dropped rather than passed through; a value that fails validation is a
 * rejected sign-up, not a cosmetic problem.
 *
 * `null` rather than a padded stand-in when nothing usable survives. Inventing
 * `ab_` to clear the three-character minimum puts a name in front of someone
 * that they did not choose and cannot recognise, and the account is perfectly
 * usable without one — the UI already renders "Not set".
 */
export const usernameFromEmail = (email: string): string | null => {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (cleaned.length < MIN_LENGTH) return null;
  return cleaned.slice(0, MAX_LENGTH);
};

/**
 * The candidates to try, in order, for a taken name.
 *
 * Numbered rather than random: `lukecfoley2` is recognisably the same person's
 * second account, and a deterministic sequence means the same collision always
 * resolves the same way. The suffix eats into {@link MAX_LENGTH} rather than
 * overflowing it, since exceeding the maximum fails validation just as surely
 * as a bad character.
 */
export function* usernameCandidates(base: string): Generator<string> {
  yield base;
  for (let n = 2; n <= 99; n += 1) {
    const suffix = String(n);
    yield `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
  }
}

/** Whatever can answer "which of these names are already taken". */
export interface UsernameLookup {
  readonly taken: (candidates: ReadonlyArray<string>) => Promise<ReadonlyArray<string>>;
}

export interface AllocatedUsername {
  readonly username: string;
  readonly displayUsername: string;
}

/**
 * The username a new account should get, or `null` to leave it unset.
 *
 * ONE lookup, not one per candidate. This runs inside `POST /sign-up/email`, and
 * probing names individually would put a D1 round-trip per collision on the
 * request path — a contended local part could cost dozens of sequential hops
 * before the account is created.
 *
 * `null` when nothing usable survives cleaning, or when every candidate is
 * taken. `username` is UNIQUE, so guessing past that turns a collision into a
 * failed sign-up.
 */
export const allocateUsername = async (
  email: string,
  lookup: UsernameLookup,
): Promise<AllocatedUsername | null> => {
  const base = usernameFromEmail(email);
  if (base === null) return null;

  const candidates = [...usernameCandidates(base)];
  const taken = new Set(await lookup.taken(candidates));
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free === undefined) return null;

  return { username: free, displayUsername: email.split("@")[0] ?? free };
};
