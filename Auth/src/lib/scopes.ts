export const SCOPES = {
  openid: {
    label: "Verify your identity",
    description: "Confirms who you are. The minimum.",
  },
  profile: {
    label: "View your profile",
    description: "Name and avatar, such as they are.",
  },
  email: {
    label: "Access your email",
    description: "Your email address and whether it has been verified.",
  },
} as const;

export type ScopeId = keyof typeof SCOPES;

export function getScopeLabel(scope: string): string {
  return (SCOPES as Record<string, { label: string }>)[scope]?.label ?? scope;
}

export function getScopeDescription(scope: string): string {
  return (SCOPES as Record<string, { description: string }>)[scope]?.description ?? "";
}
