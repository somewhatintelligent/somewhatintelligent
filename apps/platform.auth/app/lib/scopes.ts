const SCOPES = {
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
  /**
   * In `scopes` since the provider was configured, and unlabelled until now —
   * so the one scope on this screen that outlives the session was also the one
   * rendered as its raw id. A refresh token is the thing a user would most want
   * named plainly.
   */
  offline_access: {
    label: "Stay signed in",
    description: "Keeps access after you close the app, until you revoke it.",
  },
} as const;

export function getScopeLabel(scope: string): string {
  return (SCOPES as Record<string, { label: string }>)[scope]?.label ?? scope;
}
