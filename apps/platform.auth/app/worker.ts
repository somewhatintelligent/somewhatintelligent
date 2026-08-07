import startEntry from "@tanstack/react-start/server-entry";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import { observe } from "lib.observability/server";
import { within } from "lib.observability/tanstack-start/server";
import type { IdentitySession } from "./lib/session";
import type { AppVersion } from "./lib/version";
import type { IdentityEnv } from "./identity-env";
import { AVATAR_PREFIX, servedByAuth } from "../shared/ingress.ts";

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: {
        requestId: string;
        session: IdentitySession | null;
        version: AppVersion;
      };
    };
  }
}

const handler = async (request: Request, env: IdentityEnv): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (servedByAuth(pathname)) {
    return env.AUTH.fetch(request);
  }

  if (pathname.startsWith(AVATAR_PREFIX)) {
    const object = await env.AVATARS.get(pathname.slice(AVATAR_PREFIX.length));
    if (object === null) return new Response("not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers as never);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(object.body as unknown as ReadableStream, { headers });
  }

  const cookie = request.headers.get("cookie") ?? "";

  const resolved =
    cookie === ""
      ? { session: null, setCookies: [] as Array<string>, failedOpen: false }
      : await toRpcAsync<typeof env.AUTH>(env.AUTH).getSession({ cookie });
  if (!("session" in resolved)) {
    console.error(resolved);
    throw resolved.error;
  }
  const response = await startEntry.fetch(request, {
    context: {
      requestId: crypto.randomUUID(),
      session: resolved.session ?? null,
      version: env.CF_VERSION_METADATA,
    },
  });

  if (resolved.setCookies.length === 0) return response;

  const headers = new Headers(response.headers);
  for (const cookieHeader of resolved.setCookies) headers.append("set-cookie", cookieHeader);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * `within` is what connects the two halves: it parks the request's span where
 * `app/start.ts`'s middleware can find it, so a server function's span nests
 * under the request rather than starting a trace of its own.
 */
export default {
  fetch: observe(handler, { within }),
} satisfies ExportedHandler<IdentityEnv>;
