import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";
import { requireAdmin } from "@/lib/server-fn-actor";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role?: string | null;
  banned?: boolean | null;
  emailVerified?: boolean | null;
  image?: string | null;
}

export const USERS_PAGE_SIZE = 50;

export const getUsers = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: { q?: string; page?: number }) => data)
  .handler(async ({ context, data }) => {
    const q = data.q?.trim();
    const page = Math.max(1, data.page ?? 1);
    const res = await baeClient().adminListUsers({
      cookie: context.cookie,
      limit: USERS_PAGE_SIZE,
      offset: (page - 1) * USERS_PAGE_SIZE,
      ...(q ? { search: q } : {}),
    });
    if (!res.ok) throw new Error(res.error);
    return { users: res.value.users, total: res.value.total };
  });
