import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";

import type AuthWorker from "../../api/worker.ts";
import type { IdentitySession } from "./session.ts";

export const baeClient = createServerOnlyFn(function baeClient() {
  return toRpcAsync<typeof AuthWorker>(env.AUTH);
});

export const baeFetch = createServerOnlyFn(function baeFetch(request: Request) {
  return env.AUTH.fetch(request);
});

export const getSession = createServerOnlyFn(async function getSession(
  headers: Headers,
): Promise<IdentitySession | null> {
  const resolved = await baeClient().getSession({ cookie: headers.get("cookie") ?? "" });
  return "session" in resolved ? (resolved.session as IdentitySession | null) : null;
});
