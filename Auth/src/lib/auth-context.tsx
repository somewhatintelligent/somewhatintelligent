import { useServerFn } from "@tanstack/react-start";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { loadSession } from "@/lib/session.functions";
import type { IdentitySession } from "@/lib/session";

export interface AuthContextValue<S> {
  session: S | null;
  user: S extends { user: infer U } ? U | null : null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refetch: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: ReadonlyArray<string>) => boolean;
}

const Ctx = createContext<AuthContextValue<IdentitySession> | null>(null);

export function useAuth(): AuthContextValue<IdentitySession> {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error("useAuth() must be called inside an AuthProvider");
  }
  return value;
}

export function AuthProvider({
  initialSession,
  children,
}: {
  initialSession: IdentitySession | null;
  children: ReactNode;
}) {
  const fn = useServerFn(loadSession);
  const [session, setSession] = useState<IdentitySession | null>(initialSession);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setSession((await fn()) as IdentitySession | null);
    } finally {
      setIsLoading(false);
    }
  }, [fn]);

  const value = useMemo<AuthContextValue<IdentitySession>>(
    () =>
      ({
        session,
        user: session?.user ?? null,
        isAuthenticated: session != null,
        isLoading,
        refetch,
        hasRole: (role: string) => session?.user?.role === role,
        hasAnyRole: (roles: ReadonlyArray<string>) =>
          session ? roles.includes(session.user?.role ?? "") : false,
      }) as AuthContextValue<IdentitySession>,
    [session, isLoading, refetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
