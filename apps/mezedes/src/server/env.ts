/**
 * The Worker's binding contract. It lives here, not in the stack, because the
 * stack DECLARES these resources and the Worker CONSUMES them — so the arrow
 * points infra → server. `alchemy.run.ts` imports it to type what it builds.
 */

export interface Env {
  readonly BLOBS: R2Bucket;
  readonly OWNER: DurableObjectNamespace;
  readonly LOADER: WorkerLoader;
  readonly ASSETS: Fetcher;
  readonly AUTH: "access" | "none";
  readonly POLICY_AUD: string;
  readonly TEAM_DOMAIN: string;
  readonly ARTIFACT_SUFFIX: string; // e.g. "example.dev"
  /** The shell's origin, e.g. "https://mezedes.example.com". The one framer an artifact permits. */
  readonly SHELL_ORIGIN: string;
}
