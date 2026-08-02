/**
 * Better Auth's `username` plugin defaults, restated because the plugin exports
 * neither the lengths nor the pattern. `config.ts` passes the lengths back in,
 * so what is derived here and what the plugin accepts cannot drift apart.
 */
export const USERNAME_LIMITS = { minUsernameLength: 3, maxUsernameLength: 30 } as const;

/** Everything the plugin's `defaultUsernameValidator` — `/^[a-zA-Z0-9_.]+$/` — rejects. */
const ILLEGAL = /[^a-z0-9_.]+/g;

const SURROUNDING_SEPARATORS = /^[._]+|[._]+$/g;

const localPart = (email: string): string => email.split("@")[0] ?? "";

/**
 * The username an address implies, or `null` when it implies none.
 *
 * Dots and underscores survive, so `luke.c.foley@gmail.com` keeps the name its
 * owner would recognise; a `+` tag and everything else is dropped because the
 * validator would reject it. Lowercased to match the plugin's own normaliser,
 * which would otherwise rewrite the value straight after this returns.
 *
 * `null` rather than a padded stand-in when nothing usable survives. Inventing
 * `ab_` to clear the minimum puts a name in front of someone they did not
 * choose and cannot recognise, and an account is perfectly usable without one —
 * the UI already renders "Not set".
 */
export const usernameFromEmail = (email: string): string | null => {
  const cleaned = localPart(email)
    .toLowerCase()
    .replace(ILLEGAL, "")
    .replace(SURROUNDING_SEPARATORS, "");

  // Separators alone pass the validator but do not make a name.
  if (!/[a-z0-9]/.test(cleaned)) return null;
  if (cleaned.length < USERNAME_LIMITS.minUsernameLength) return null;
  return cleaned.slice(0, USERNAME_LIMITS.maxUsernameLength);
};

/**
 * The candidates to try, in order, for a taken name.
 *
 * Numbered rather than random: `luke.c.foley2` is recognisably the same
 * person's second account, and a deterministic sequence resolves the same
 * collision the same way every time. The suffix eats into the maximum rather
 * than overflowing it, since exceeding the maximum fails validation just as
 * surely as a bad character.
 */
export function* usernameCandidates(base: string): Generator<string> {
  yield base;
  for (let n = 2; n <= 99; n += 1) {
    const suffix = String(n);
    yield `${base.slice(0, USERNAME_LIMITS.maxUsernameLength - suffix.length)}${suffix}`;
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

  // The address's own casing is worth keeping, but only while it still names
  // the account that was allocated — a numbered candidate no longer does.
  const original = localPart(email);
  return { username: free, displayUsername: original.toLowerCase() === free ? original : free };
};
