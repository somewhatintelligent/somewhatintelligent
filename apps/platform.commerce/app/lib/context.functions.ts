/**
 * Who the operator is, and which deployment they are looking at.
 *
 * Reaches no backend: it reads back the request context `app/worker.ts` already
 * wrote after verifying the Access assertion. That is what makes it the SMOKE
 * TEST for the whole pipeline — Access → boundary → request context → server
 * function. If this returns an actor, every mutation the console offers is
 * running as a verified person.
 *
 * `paymentsEnvironment` rides along because it changes how everything else on
 * screen should be read: the same buttons move real money on `live` and do not
 * on `dev`.
 *
 * Top level because the Start compiler AST-extracts each handler into its own
 * module, keyed on the declaration.
 */
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";

import type { OperatorActor } from "../../domain/Contracts.ts";

interface OperatorContext {
  readonly actor: OperatorActor | null;
  /** `dev` | `sandbox` | `live` — which Stripe account this deployment settles against. */
  readonly paymentsEnvironment: string | null;
  readonly version: { readonly id: string; readonly tag: string } | null;
}

export const loadOperatorContext = createServerFn({ method: "GET" }).handler(
  (): OperatorContext => {
    const context = getGlobalStartContext() as
      | {
          actor?: OperatorActor;
          paymentsEnvironment?: string;
          version?: { id: string; tag: string };
        }
      | undefined;
    return {
      actor: context?.actor ?? null,
      paymentsEnvironment: context?.paymentsEnvironment ?? null,
      version: context?.version ?? null,
    };
  },
);
