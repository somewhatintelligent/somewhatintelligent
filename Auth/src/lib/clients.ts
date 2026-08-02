const MANAGED_PREFIX = "managed:";

export function isManaged(referenceId: string | null | undefined): boolean {
  return referenceId?.startsWith(MANAGED_PREFIX) ?? false;
}
