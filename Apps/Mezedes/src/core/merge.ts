export interface MergeInput {
  readonly base: Readonly<Record<string, string>>;
  readonly supplied: Readonly<Record<string, string>>;
  readonly removed: readonly string[];
}

/** Right-biased over `base`, then `removed` applied. Pure; the correctness core. */
export const mergeFiles = (input: MergeInput): Record<string, string> => {
  const merged: Record<string, string> = { ...input.base, ...input.supplied };
  for (const path of input.removed) delete merged[path];
  return merged;
};
