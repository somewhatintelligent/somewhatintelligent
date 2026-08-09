/**
 * This is a little bit masturbatory, but I'm using Effect and "when in Rome"
 * I don't want sprawling resources on my accounts, and agents will sometimes spin shit up in
 * random stages. Also, I just like standards. I will do anything to feel in control.
 */

import * as Alchemy from "alchemy";
import * as Brand from "effect/Brand";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Effectable from "effect/Effectable";
import * as Data from "effect/Data";
import { PRODUCTION_ZONE, workerSafeStage } from "platform.names";
import { SANDBOX } from "./sandbox.ts";

const PATTERN =
  /^(placeholder|production|staging|test|pr_(0|[1-9][0-9]*)|(test|dev|debug)_[a-z0-9][a-z0-9-]*)$/;

/**
 * Alchemy's sentinel for a stack it evaluates without a plan — `state`, `login`,
 * `profile show`, `unsafe nuke` all scaffold one to reach the providers and the
 * state layer. `deploy`, `dev`, `destroy`, `tail`, `logs` and `sync` pass the
 * real `--stage` through, so nothing that writes arrives here.
 */

export type StandardizedStageShape =
  | "production"
  | "staging"
  | "test"
  | `pr_${number}`
  | `test_${string}`
  | `dev_${string}`
  | `debug_${string}`
  | "placeholder";

export type StandardizedStage = StandardizedStageShape & Brand.Brand<"Stage">;

const isStandardizedStage = (s: string): s is StandardizedStage => PATTERN.test(s);

const ALLOW_NONSTANDARD = Config.boolean("ALLOW_NONSTANDARD").pipe(Config.withDefault(false));

export const StandardizedStage = Object.assign(
  Brand.make<StandardizedStage>((s) =>
    isStandardizedStage(s) ? true : `"${s}" is not a valid Stage`,
  ),
  Effectable.Prototype<Effect.Effect<StandardizedStage, never, Alchemy.Stack>>({
    label: "StandardizedStage",
    evaluate: () =>
      Effect.gen(function* () {
        const { stage } = yield* Alchemy.Stack;
        if (isStandardizedStage(stage)) return stage;
        // Escape hatch for destroying stages that predate the standard.
        if (yield* ALLOW_NONSTANDARD) return stage as StandardizedStage;
        return yield* decodeStandardizedStage(stage);
      }).pipe(Effect.orDie),
  }),
);

export class NonstandardStage extends Data.TaggedError("NonstandardStage")<{
  readonly stage: string;
}> {
  static ALLOWED = "production | staging | test | pr_<n> | test_<name> | dev_<name> | debug_<name>";
  override get message() {
    return `"${this.stage}" does not meet the standardized stage conventions. Please use one of ${NonstandardStage.ALLOWED}`;
  }
}

export type Tier = "production" | "staging" | "ephemeral";

export const tierOf = (stage: StandardizedStage): Tier =>
  stage === "production" ? "production" : stage === "staging" ? "staging" : "ephemeral";

/**
 * Tier of a raw stage name, for the paths where the stack is only optionally
 * present — a worker's layers build once at deploy and again per event, and the
 * second time there is no stack to decode against. An unrecognised name is
 * ephemeral, which is the safe answer everywhere it is asked.
 */
export const tierOfName = (stage: string): Tier =>
  isStandardizedStage(stage) ? tierOf(stage) : "ephemeral";

export const StageTier: Effect.Effect<Tier, never, Alchemy.Stack> = Effect.gen(function* () {
  return tierOf(yield* StandardizedStage);
});

/**
 * THE conditional primitive for deployment shape. An exhaustive record over
 * {@link Tier}, so a call site cannot forget a case and adding a tier is a
 * compile error at every one of them.
 *
 * Prefer this over `production ? a : b` anywhere the decision is about WHERE
 * the stack is deploying. A ternary answers "is this production" and silently
 * lumps `staging` in with `pr_41`; the record has to say what staging does.
 */
export const Tiered = <const R extends Record<Tier, unknown>>(
  cases: R,
): Effect.Effect<R[Tier], never, Alchemy.Stack> => Effect.map(StageTier, (tier) => cases[tier]);

/**
 * {@link Tiered} for Effect-valued cases, flattened — only the chosen one runs.
 *
 * The requirements UNION across cases rather than being one `R` shared by all
 * three, which is the whole reason this is written with extractors instead of
 * `Record<Tier, Effect<A, E, R>>`: the tiers legitimately need different
 * services. A production case that declares an Access application needs the
 * Cloudflare providers; the preview case beside it needs the auth stack's
 * outputs and nothing else. Forcing one `R` makes the two mutually
 * unassignable, and the caller's only way out is a cast that erases the
 * requirement the runtime still has.
 */
export const TieredEffect = <const Cases extends Record<Tier, Effect.Effect<any, any, any>>>(
  cases: Cases,
): Effect.Effect<
  Effect.Success<Cases[Tier]>,
  Effect.Error<Cases[Tier]>,
  Effect.Services<Cases[Tier]> | Alchemy.Stack
> => Effect.flatMap(StageTier, (tier) => cases[tier]);

/**
 * The stage facts every stack needs, resolved once. Yielding this is what
 * validates the stage name, so a stack that uses it cannot reach a nonstandard
 * one.
 */
export const Deployment = Effect.gen(function* () {
  const stage = yield* StandardizedStage;
  const tier = tierOf(stage);
  const production = tier === "production";
  const suffix = production ? "" : `-${workerSafeStage(stage)}`;
  return {
    stage,
    tier,
    production,
    suffix,
    dev: yield* Effect.orDie(Alchemy.ALCHEMY_DEV),
    host: (label: string, zone: string = PRODUCTION_ZONE) => `${label}${suffix}.${zone}`,
  };
});

/** What fronts a unit's HTTP surface. */
export type Gate = "access" | "none";

/**
 * The gate a unit deploys behind, per tier. `access` everywhere by default; a
 * unit that is PUBLIC in production overrides that one case and keeps the
 * default for the rest, so a new preview surface is closed unless someone
 * writes down that it should be open.
 *
 * `none` UNDER `alchemy dev` AND UNDER `SANDBOX`, neither of which is a tier
 * case. A local workerd has no Access edge in front of it and never will, so
 * there is no assertion to verify and a gate would only lock a developer out of
 * their own machine; a `SANDBOX` run has no standing to create the application
 * in the first place.
 *
 * THOSE TWO CONDITIONS ARE EXACTLY THE ONES UNDER WHICH
 * `apps/platform.auth/api/preview-access.ts` DECLARES NO APPLICATION, and they
 * are spelled here so the two cannot drift. When they did, a `SANDBOX` deploy
 * shipped `GATE="access"` with an empty `POLICY_AUD` — a Worker that answers
 * 500 to every request, because a gate with nothing to verify against fails
 * closed and is right to.
 */
export const GateFor = (
  overrides: Partial<Record<Tier, Gate>> = {},
): Effect.Effect<Gate, never, Alchemy.Stack> =>
  Effect.gen(function* () {
    const { dev } = yield* Deployment;
    if (dev) return "none";
    if (yield* Effect.orDie(SANDBOX)) return "none";
    return yield* Tiered({
      production: overrides.production ?? "access",
      staging: overrides.staging ?? "access",
      ephemeral: overrides.ephemeral ?? "access",
    });
  });

export class DisallowedStage extends Data.TaggedError("DisallowedStage")<{
  readonly stack: string;
  readonly stage: StandardizedStage;
  readonly tier: Tier;
  readonly allowed: readonly Tier[];
}> {
  override get message() {
    return `Stack "${this.stack}" may only deploy to ${this.allowed.join(" | ")} stages, but "${this.stage}" is ${this.tier}.`;
  }
}

const decodeStandardizedStage = (
  stage: string,
): Effect.Effect<StandardizedStage, NonstandardStage> =>
  isStandardizedStage(stage) ? Effect.succeed(stage) : new NonstandardStage({ stage });

export const guardStage = (
  ...allowed: readonly [Tier, ...Tier[]]
): Effect.Effect<StandardizedStage, never, Alchemy.Stack> =>
  Effect.gen(function* () {
    const { name } = yield* Alchemy.Stack;
    const stage = yield* StandardizedStage;
    if (stage === "placeholder") return stage;
    const tier = tierOf(stage);
    return allowed.includes(tier)
      ? stage
      : yield* Effect.die(new DisallowedStage({ stack: name, stage, tier, allowed }));
  });
