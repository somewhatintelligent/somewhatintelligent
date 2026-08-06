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

export const StageTier: Effect.Effect<Tier, never, Alchemy.Stack> = Effect.gen(function* () {
  return tierOf(yield* StandardizedStage);
});

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
