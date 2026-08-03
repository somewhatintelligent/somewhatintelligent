/**
 * Release version labels.
 *
 * A VERSION IS A LABEL, NOT AN INPUT. It exists so a release has something
 * human to point at — "v3 of this shirt" — and that is the whole job. Requiring
 * the operator to invent one made a decorative idea load-bearing on the write
 * path: fixing a typo meant choosing a number, and reusing one refused the
 * publish outright.
 *
 * Extracted from `Domain/Contracts.ts` unchanged. Pure string arithmetic with
 * no I/O, so it belongs where it can be tested without a deployment.
 */

/**
 * Canonical core SemVer: no `v` prefix, no leading zeros, no pre-release or
 * build metadata. A release publishes under an operator-supplied version of
 * exactly this shape.
 */
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const isValidVersion = (value: string): boolean => SEMVER_PATTERN.test(value);

/** Which part of the label moves. A release is any of the three. */
export type Bump = "major" | "minor" | "patch";

/** The first release a product ever publishes. */
const FIRST_VERSION = "1.0.0";

/**
 * The next version for a product, derived from what it has already published.
 *
 * DERIVED FROM THE LATEST, not from the largest component seen. The previous
 * version read only the minor and pasted it under a hardcoded major, which was
 * wrong in both directions: publishing after a hand-supplied `2.0.0` produced
 * `1.1.0` — going backwards — and a product whose only release was `2.3.0`
 * produced `1.4.0`, a number bearing no relation to anything.
 *
 * `minor` is the default because a release usually is one: a new colourway, a
 * restock, a corrected photo. `patch` is for a fix to a release already out
 * (a typo in the description), and `major` for a redesign an operator wants
 * marked as such. None of it carries compatibility meaning — these describe a
 * garment, not an API — but the shape should still be honest.
 *
 * Unparseable versions are ignored rather than coerced, so one bad row written
 * by hand cannot drag every future derivation down with it.
 */
export const nextVersion = (published: readonly string[], bump: Bump = "minor"): string => {
  const latest = [...published].filter(isValidVersion).sort(compareVersions).pop();
  if (latest === undefined) return FIRST_VERSION;

  const parts = latest.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
};

/** Compare two core SemVers. Returns <0, 0, or >0. */
export const compareVersions = (a: string, b: string): number => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};
