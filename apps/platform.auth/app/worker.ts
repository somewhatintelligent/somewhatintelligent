import startEntry from "@tanstack/react-start/server-entry";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import type { IdentitySession } from "./lib/session";
import type { AppVersion } from "./lib/version";
import type { IdentityEnv } from "./identity-env";
import { AUTH_BASE_PATH, AVATAR_PREFIX } from "../shared/ingress.ts";

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

export default {
  async fetch(request: Request, env: IdentityEnv): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith(AUTH_BASE_PATH)) {
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
  },
} satisfies ExportedHandler<IdentityEnv>;
