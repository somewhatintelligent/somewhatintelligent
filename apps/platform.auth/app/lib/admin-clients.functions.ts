import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { requireAdmin } from "@/lib/server-fn-actor";
import { toStringArray } from "@/lib/normalize";

interface ClientDetail {
  id: string;
  clientId: string;
  name: string | null;
  redirectUris: string[];
  skipConsent: boolean | null;
  referenceId: string | null;
}

interface ClientDetailPayload {
  client: ClientDetail;
  tokenCount: number;
  consentCount: number;
}

interface CreateClientInput {
  name: string;
  redirectUris: string[];
  skipConsent: boolean;
}

export interface CreateClientResult {
  clientId: string;
  clientSecret: string;
}

export const getClients = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    // The RPC's success arm (drizzle rows) isn't `Rpc.Serializable`, so the
    // stub type drops it and leaves only the `RpcErr` arms; re-assert the
    // success shape so the guard narrows to it.
    const res = await baeClient().adminListClients({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return {
      clients: res.clients,
    };
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }): Promise<ClientDetailPayload> => {
    // The RPC's success arm (a drizzle row) isn't `Rpc.Serializable`, so the
    // stub type drops it and leaves only the `RpcErr` arms; re-assert the
    // success shape so the guard narrows to it.
    const res = await baeClient().adminGetClient({ cookie: context.cookie, clientId: data.id });
    if (!res.ok) {
      if (res.error === "not_found") throw notFound();
      throw new Error(res.error);
    }
    const raw = res.client;
    return {
      client: {
        id: raw.id as string,
        clientId: raw.clientId as string,
        name: (raw.name ?? null) as string | null,
        redirectUris: toStringArray(raw.redirectUris),
        skipConsent: (raw.skipConsent ?? null) as boolean | null,
        referenceId: (raw.referenceId ?? null) as string | null,
      },
      tokenCount: res.tokenCount,
      consentCount: res.consentCount,
    };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: CreateClientInput) => data)
  .handler(async ({ context, data }): Promise<CreateClientResult> => {
    const res = await baeClient().adminCreateClient({
      cookie: context.cookie,
      name: data.name,
      redirectUris: data.redirectUris,
      skipConsent: data.skipConsent,
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return {
      clientId: String(res.value.clientId),
      clientSecret: String(res.value.clientSecret ?? ""),
    };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    (data: { id: string; name?: string; redirectUris?: string[]; skipConsent?: boolean }) => data,
  )
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminUpdateClient({
      cookie: context.cookie,
      clientId: data.id,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.redirectUris !== undefined && { redirectUris: data.redirectUris }),
      ...(data.skipConsent !== undefined && { skipConsent: data.skipConsent }),
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return { success: true as const };
  });

export const rotateSecret = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }): Promise<{ clientSecret: string }> => {
    const res = await baeClient().adminRotateClientSecret({
      cookie: context.cookie,
      clientId: data.id,
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return { clientSecret: String(res.value.clientSecret ?? "") };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    const res = await baeClient().adminDeleteClient({ cookie: context.cookie, clientId: data.id });
    if (!res.ok) {
      if (res.error === "managed_client") {
        throw new Error("Managed clients cannot be deleted");
      }
      throw new Error(res.error ?? "Failed to delete client");
    }
    return { success: true as const };
  });
