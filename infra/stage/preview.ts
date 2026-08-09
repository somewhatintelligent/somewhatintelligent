/**
 * THE STAGE'S SHARED ACCESS APPLICATION, as the stacks downstream of auth read
 * it.
 *
 * WHY TWO FLAT STRINGS RATHER THAN A NULLABLE OBJECT. The obvious shape is
 * `preview: { aud, teamDomain } | null` — `null` on production, where each unit
 * owns its own application. It does not survive contact with alchemy: a stack
 * output is an `Output`, and `ObjectExpr` derives its property accessors from
 * `keyof A`. For a nullable `A` that is `keyof ({…} | null)`, which is `never`,
 * so `auth.preview.aud` does not exist and `auth.preview === null` compares an
 * unresolved expression against a literal — always false, silently. The
 * emptiness has to live INSIDE the resolved values, not in the type around
 * them.
 *
 * So production exports two empty strings, and nothing reads them: whether this
 * stage has a shared application is decided by TIER at each call site, which is
 * already the one place that decision is made.
 */
import * as Output from "alchemy/Output";

/** What a gated Worker needs in order to verify an assertion. */
export interface PreviewAccess {
  /** The application's own `aud`. What pins a token to THIS stage. */
  readonly aud: string;
  /** With the scheme — it is what Access puts in `iss`. */
  readonly teamDomain: string;
}

/**
 * Read the facts, refusing a deploy that would produce an ungated Worker.
 *
 * AT RESOLUTION, NOT AT DECLARATION, and it has to be: the values are outputs
 * of another stack, so there is nothing to inspect until alchemy resolves them.
 * Throwing inside `Output.map` fails the deploy at that moment — the same
 * mechanism `apps/platform.auth/alchemy.run.ts` uses to refuse a production
 * deploy that adopted the wrong database.
 *
 * Reaching this with empty strings means the auth stack resolved as PRODUCTION
 * while this one resolved as a preview — the two disagreeing about a stage name
 * they both derive from. It should be unreachable; a Worker deployed with no
 * `aud` fails open on every request, so it is not a thing to find out later.
 */
export const requirePreview = (
  aud: Output.Output<string>,
  teamDomain: Output.Output<string>,
  unit: string,
): PreviewAccess => ({
  aud: Output.map(aud, refuseEmpty(unit, "POLICY_AUD")) as unknown as string,
  teamDomain: Output.map(teamDomain, refuseEmpty(unit, "TEAM_DOMAIN")) as unknown as string,
});

const refuseEmpty = (unit: string, name: string) => (value: string) => {
  if (value === "") {
    throw new Error(
      `${unit}: the auth stack exported an empty ${name} for a non-production stage. ` +
        `It has no shared Access application to point at, and deploying would leave ${unit} ungated.`,
    );
  }
  return value;
};
