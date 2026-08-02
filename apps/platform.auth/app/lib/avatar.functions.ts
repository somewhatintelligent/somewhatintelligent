import { createServerFn } from "@tanstack/react-start";

import { baeClient } from "@/lib/bae.server";
import { requireUser } from "@/lib/server-fn-actor";
import type { AvatarContentType } from "../../shared/ingress.ts";

export const uploadAvatar = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: { base64: string; contentType: AvatarContentType }) => data)
  .handler(async ({ context, data }) => {
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const res = await baeClient().setAvatar({
      cookie: context.cookie,
      bytes: bytes.buffer as ArrayBuffer,
      contentType: data.contentType,
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, image: res.image };
  });

export const removeAvatarFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const res = await baeClient().removeAvatar({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return { ok: true as const, image: res.image };
  });
