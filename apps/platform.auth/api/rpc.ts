import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import type { AuthApiError } from "lib.better-auth-effect";
import { ALLOWED_AVATAR_TYPES, AVATAR_PREFIX, MAX_AVATAR_BYTES } from "../shared/ingress.ts";
import { AvatarBucket } from "./avatars.ts";
import { AuthDatabase } from "./database.ts";
import type { Auth } from "./config.ts";

const headers = (cookie: string) => new Headers({ cookie });

const toScopeList = (scopes: unknown): ReadonlyArray<string> =>
  typeof scopes === "string"
    ? scopes.split(" ").filter(Boolean)
    : Array.isArray(scopes)
      ? scopes.map(String)
      : [];

const setCookiesOf = (from: Headers): Array<string> => {
  const readable = from as Headers & { readonly getSetCookie?: () => Array<string> };
  return readable.getSetCookie?.() ?? [];
};

const userKeyOf = (image: string | null | undefined): string | null =>
  typeof image === "string" && image.startsWith(AVATAR_PREFIX)
    ? image.slice(AVATAR_PREFIX.length)
    : null;

const failed = (error: string) => ({ ok: false as const, error });

interface Connection {
  readonly consentId: string;
  readonly clientId: string;
  readonly scopes: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly clientName: string | null;
  readonly clientIcon: string | null;
}

const attempt = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((error: E) => {
      const api = error as Partial<AuthApiError>;
      return Effect.succeed(
        failed(
          error._tag === "AuthApiError" ? (api.code ?? `http_${api.status ?? 0}`) : error._tag,
        ),
      );
    }),
  );

export const authRpc = function* (auth: Auth) {
  const connection = yield* Cloudflare.D1.QueryDatabase(AuthDatabase);
  const avatars = yield* Cloudflare.R2.ReadWriteBucket(AvatarBucket);

  const query = <T>(sql: string, ...bindings: ReadonlyArray<unknown>) =>
    Effect.flatMap(connection.raw, (d1) =>
      Effect.promise(() =>
        d1
          .prepare(sql)
          .bind(...bindings)
          .all<T>(),
      ),
    );

  const adminGate = (cookie: string) =>
    attempt(auth.api.listUsers({ headers: headers(cookie), query: { limit: 1 } }));

  return {
    getSession: (input: { readonly cookie: string }) =>
      auth
        .call((api) => api.getSession({ headers: headers(input.cookie), returnHeaders: true }))
        .pipe(
          Effect.map((result) => ({
            session: result.response ?? null,
            setCookies: setCookiesOf(result.headers),
            failedOpen: false,
          })),
          Effect.catchCause((cause) =>
            Effect.as(Effect.logWarning("bae: getSession failed open", cause), {
              session: null,
              setCookies: [] as Array<string>,
              failedOpen: true,
            }),
          ),
        ),

    getProviders: () =>
      Effect.succeed({
        social: { google: false, microsoft: false, facebook: false, linkedin: false },
      }),

    getConnections: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const consents = yield* attempt(
          auth.api.getOAuthConsents({ headers: headers(input.cookie) }),
        );
        if (!consents.ok) return consents;
        const clients = yield* attempt(
          auth.api.getOAuthClients({ headers: headers(input.cookie) }),
        );

        const byId = new Map(
          (clients.ok ? ((clients.value ?? []) as Array<Record<string, unknown>>) : []).map(
            (client) => [client.clientId ?? client.client_id, client] as const,
          ),
        );

        return {
          ok: true as const,
          connections: ((consents.value ?? []) as Array<Record<string, unknown>>).map(
            (consent): Connection => {
              const client = byId.get(consent.clientId);
              return {
                consentId: String(consent.id ?? ""),
                clientId: String(consent.clientId ?? ""),
                scopes: toScopeList(consent.scopes),
                createdAt: String(consent.createdAt ?? ""),
                clientName: (client?.name ?? client?.client_name ?? null) as string | null,
                clientIcon: (client?.icon ?? null) as string | null,
              };
            },
          ),
        };
      }),

    adminStats: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const counts = yield* query<{ users: number; sessions: number; clients: number }>(
          `SELECT (SELECT COUNT(*) FROM "user") AS users,
                  (SELECT COUNT(*) FROM "session") AS sessions,
                  (SELECT COUNT(*) FROM "oauthClient") AS clients`,
        );
        const row = counts.results[0];

        return {
          ok: true as const,
          users: row?.users ?? 0,
          sessions: row?.sessions ?? 0,
          clients: row?.clients ?? 0,
        };
      }),

    adminListSessions: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const rows = yield* query<{
          id: string;
          userId: string;
          ipAddress: string | null;
          userAgent: string | null;
          createdAt: number;
          expiresAt: number;
          userName: string | null;
          userEmail: string | null;
          userImage: string | null;
        }>(
          `SELECT s."id", s."userId", s."ipAddress", s."userAgent", s."createdAt", s."expiresAt",
                  u."name" AS userName, u."email" AS userEmail, u."image" AS userImage
             FROM "session" s
             LEFT JOIN "user" u ON u."id" = s."userId"
            ORDER BY s."createdAt" DESC
            LIMIT 100`,
        );

        return { ok: true as const, sessions: rows.results };
      }),

    adminListUsers: (input: {
      readonly cookie: string;
      readonly search?: string;
      readonly limit?: number;
      readonly offset?: number;
    }) =>
      attempt(
        auth.api.listUsers({
          headers: headers(input.cookie),
          query: {
            limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
            offset: input.offset ?? 0,
            ...(input.search === undefined || input.search.trim() === ""
              ? {}
              : {
                  searchField: "email" as const,
                  searchOperator: "contains" as const,
                  searchValue: input.search.trim(),
                }),
          },
        }),
      ),

    adminListApiKeys: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const rows = yield* query<{
          id: string;
          name: string | null;
          prefix: string | null;
          enabled: number;
          createdAt: number;
          ownerEmail: string | null;
        }>(
          `SELECT k."id", k."name", k."prefix", k."enabled", k."createdAt",
                  u."email" AS ownerEmail
             FROM "apikey" k
             LEFT JOIN "user" u ON u."id" = k."referenceId"
            ORDER BY k."createdAt" DESC
            LIMIT 100`,
        );

        return { ok: true as const, apiKeys: rows.results };
      }),

    adminListClients: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const gate = yield* attempt(auth.api.getOAuthClients({ headers: headers(input.cookie) }));
        if (!gate.ok) return gate;

        const rows = yield* query<{
          id: string;
          clientId: string;
          name: string | null;
          type: string | null;
          referenceId: string | null;
        }>(
          `SELECT "id", "clientId", "name", "type", "referenceId"
             FROM "oauthClient" ORDER BY "createdAt" DESC LIMIT 200`,
        );

        return { ok: true as const, clients: rows.results };
      }),

    adminGetClient: (input: { readonly cookie: string; readonly clientId: string }) =>
      Effect.gen(function* () {
        const found = yield* attempt(
          auth.api.getOAuthClient({
            headers: headers(input.cookie),
            query: { client_id: input.clientId },
          }),
        );
        if (!found.ok) return found;
        if (found.value === null || found.value === undefined) return failed("not_found");

        const counts = yield* query<{ tokens: number; consents: number }>(
          `SELECT (SELECT COUNT(*) FROM "oauthAccessToken" WHERE "clientId" = ?1) AS tokens,
                  (SELECT COUNT(*) FROM "oauthConsent" WHERE "clientId" = ?1) AS consents`,
          input.clientId,
        );

        return {
          ok: true as const,
          client: found.value as unknown as Record<string, unknown>,
          tokenCount: counts.results[0]?.tokens ?? 0,
          consentCount: counts.results[0]?.consents ?? 0,
        };
      }),

    adminCreateClient: (input: {
      readonly cookie: string;
      readonly name: string;
      readonly redirectUris: ReadonlyArray<string>;
      readonly skipConsent?: boolean;
    }) =>
      Effect.gen(function* () {
        if (input.name.trim().length < 2) return failed("name_too_short");
        if (input.redirectUris.length < 1) return failed("no_redirect_uri");

        return yield* attempt(
          auth.api.adminCreateOAuthClient({
            headers: headers(input.cookie),
            body: {
              client_name: input.name.trim(),
              redirect_uris: [...input.redirectUris],
              ...(input.skipConsent === undefined ? {} : { skip_consent: input.skipConsent }),
            },
          }),
        );
      }),

    adminUpdateClient: (input: {
      readonly cookie: string;
      readonly clientId: string;
      readonly name?: string;
      readonly redirectUris?: ReadonlyArray<string>;
      readonly skipConsent?: boolean;
    }) =>
      attempt(
        auth.api.adminUpdateOAuthClient({
          headers: headers(input.cookie),
          body: {
            client_id: input.clientId,
            update: {
              ...(input.name === undefined ? {} : { client_name: input.name }),
              ...(input.redirectUris === undefined
                ? {}
                : { redirect_uris: [...input.redirectUris] }),
              ...(input.skipConsent === undefined ? {} : { skip_consent: input.skipConsent }),
            },
          },
        }),
      ),

    adminRotateClientSecret: (input: { readonly cookie: string; readonly clientId: string }) =>
      attempt(
        auth.api.rotateClientSecret({
          headers: headers(input.cookie),
          body: { client_id: input.clientId },
        }),
      ),

    setAvatar: (input: {
      readonly cookie: string;
      readonly bytes: ArrayBuffer;
      readonly contentType: string;
    }) =>
      Effect.gen(function* () {
        if (!ALLOWED_AVATAR_TYPES.includes(input.contentType as never)) {
          return failed("unsupported_media_type");
        }
        if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_AVATAR_BYTES) {
          return failed("payload_too_large");
        }

        const current = yield* attempt(auth.api.getSession({ headers: headers(input.cookie) }));
        if (!current.ok) return current;
        const userId = current.value?.user?.id;
        if (userId === undefined) return failed("unauthorized");

        const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", input.bytes));
        const hash = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 32);
        const key = `${userId}/${hash}`;

        yield* Effect.flatMap(avatars.raw, (bucket) =>
          Effect.promise(() =>
            bucket.put(key, input.bytes, { httpMetadata: { contentType: input.contentType } }),
          ),
        );

        const image = `${AVATAR_PREFIX}${key}`;
        const updated = yield* attempt(
          auth.api.updateUser({ headers: headers(input.cookie), body: { image } }),
        );
        if (!updated.ok) return updated;

        return { ok: true as const, image };
      }),

    removeAvatar: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const current = yield* attempt(auth.api.getSession({ headers: headers(input.cookie) }));
        if (!current.ok) return current;
        const key = userKeyOf(current.value?.user?.image);
        if (key !== null) {
          yield* Effect.flatMap(avatars.raw, (bucket) => Effect.promise(() => bucket.delete(key)));
        }

        const updated = yield* attempt(
          auth.api.updateUser({ headers: headers(input.cookie), body: { image: null } }),
        );
        if (!updated.ok) return updated;

        return { ok: true as const, image: null };
      }),

    publicClientPrelogin: (input: { readonly client_id: string; readonly oauth_query: string }) =>
      attempt(
        auth.api.getOAuthClientPublicPrelogin({
          body: { client_id: input.client_id, oauth_query: input.oauth_query },
        }),
      ),

    adminListOrgs: (input: { readonly cookie: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const rows = yield* query<{
          id: string;
          slug: string;
          name: string;
          logo: string | null;
          createdAt: number;
          memberCount: number;
          ownerName: string | null;
        }>(
          `SELECT o."id", o."slug", o."name", o."logo", o."createdAt",
                  (SELECT COUNT(*) FROM "member" m WHERE m."organizationId" = o."id") AS memberCount,
                  (SELECT u."name" FROM "member" m2
                     LEFT JOIN "user" u ON u."id" = m2."userId"
                    WHERE m2."organizationId" = o."id" AND m2."role" = 'owner'
                    LIMIT 1) AS ownerName
             FROM "organization" o
            ORDER BY o."createdAt" DESC
            LIMIT 200`,
        );

        return { ok: true as const, organizations: rows.results };
      }),

    adminSearchUsersByEmail: (input: { readonly cookie: string; readonly email: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const rows = yield* query<{
          id: string;
          name: string | null;
          email: string;
          image: string | null;
        }>(
          `SELECT "id", "name", "email", "image" FROM "user"
            WHERE "email" LIKE ?1 ORDER BY "email" LIMIT 20`,
          `%${input.email.trim()}%`,
        );

        return { ok: true as const, users: rows.results };
      }),

    adminGetOrg: (input: { readonly cookie: string; readonly id: string }) =>
      Effect.gen(function* () {
        const gate = yield* adminGate(input.cookie);
        if (!gate.ok) return gate;

        const orgs = yield* query<{
          id: string;
          slug: string;
          name: string;
          logo: string | null;
          createdAt: number;
          metadata: string | null;
        }>(
          `SELECT "id", "slug", "name", "logo", "createdAt", "metadata"
             FROM "organization" WHERE "id" = ?1 LIMIT 1`,
          input.id,
        );
        const organization = orgs.results[0];
        if (organization === undefined) return failed("not_found");

        const members = yield* query<{
          memberId: string;
          userId: string;
          name: string | null;
          email: string | null;
          image: string | null;
          role: string;
          joinedAt: number;
        }>(
          `SELECT m."id" AS memberId, m."userId", u."name", u."email", u."image",
                  m."role", m."createdAt" AS joinedAt
             FROM "member" m LEFT JOIN "user" u ON u."id" = m."userId"
            WHERE m."organizationId" = ?1
            ORDER BY m."createdAt"`,
          input.id,
        );

        const invitations = yield* query<{
          id: string;
          email: string;
          role: string;
          status: string;
          expiresAt: number;
          inviterName: string | null;
        }>(
          `SELECT i."id", i."email", i."role", i."status", i."expiresAt",
                  u."name" AS inviterName
             FROM "invitation" i LEFT JOIN "user" u ON u."id" = i."inviterId"
            WHERE i."organizationId" = ?1
            ORDER BY i."expiresAt" DESC`,
          input.id,
        );

        return {
          ok: true as const,
          organization,
          members: members.results,
          invitations: invitations.results,
        };
      }),

    adminCreateOrg: (input: {
      readonly cookie: string;
      readonly name: string;
      readonly slug: string;
      readonly ownerUserId: string;
    }) =>
      Effect.gen(function* () {
        const created = yield* attempt(
          auth.api.createOrganization({
            headers: headers(input.cookie),
            body: { name: input.name, slug: input.slug, userId: input.ownerUserId },
          }),
        );
        if (!created.ok) return created;
        return { ok: true as const, organization: created.value };
      }),

    adminUpdateOrg: (input: {
      readonly cookie: string;
      readonly id: string;
      readonly name?: string;
      readonly slug?: string;
    }) =>
      Effect.gen(function* () {
        const updated = yield* attempt(
          auth.api.updateOrganization({
            headers: headers(input.cookie),
            body: {
              organizationId: input.id,
              data: {
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.slug === undefined ? {} : { slug: input.slug }),
              },
            },
          }),
        );
        if (!updated.ok) return updated;
        return { ok: true as const, organization: updated.value };
      }),

    adminAddOrgMember: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly userId: string;
      readonly role: string;
    }) =>
      attempt(
        auth.api.addMember({
          headers: headers(input.cookie),
          body: {
            organizationId: input.orgId,
            userId: input.userId,
            role: input.role as "member",
          },
        }),
      ),

    adminUpdateOrgMemberRole: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly userId: string;
      readonly role: string;
    }) =>
      attempt(
        auth.api.updateMemberRole({
          headers: headers(input.cookie),
          body: {
            organizationId: input.orgId,
            memberId: input.userId,
            role: input.role as "member",
          },
        }),
      ),

    adminRemoveOrgMember: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly userId: string;
    }) =>
      attempt(
        auth.api.removeMember({
          headers: headers(input.cookie),
          body: { organizationId: input.orgId, memberIdOrEmail: input.userId },
        }),
      ),

    adminCreateOrgInvitation: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly email: string;
      readonly role: string;
    }) =>
      Effect.gen(function* () {
        const invited = yield* attempt(
          auth.api.createInvitation({
            headers: headers(input.cookie),
            body: {
              organizationId: input.orgId,
              email: input.email,
              role: input.role as "member",
            },
          }),
        );
        if (!invited.ok) return invited;
        return { ok: true as const, invitation: invited.value };
      }),

    adminResendOrgInvitation: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly invitationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* query<{ email: string; role: string }>(
          `SELECT "email", "role" FROM "invitation" WHERE "id" = ?1 AND "organizationId" = ?2 LIMIT 1`,
          input.invitationId,
          input.orgId,
        );
        const previous = rows.results[0];
        if (previous === undefined) return failed("not_found");

        const cancelled = yield* attempt(
          auth.api.cancelInvitation({
            headers: headers(input.cookie),
            body: { invitationId: input.invitationId },
          }),
        );
        if (!cancelled.ok) return cancelled;

        const invited = yield* attempt(
          auth.api.createInvitation({
            headers: headers(input.cookie),
            body: {
              organizationId: input.orgId,
              email: previous.email,
              role: previous.role as "member",
              resend: true,
            },
          }),
        );
        if (!invited.ok) return invited;
        return { ok: true as const, invitation: invited.value };
      }),

    adminCancelOrgInvitation: (input: {
      readonly cookie: string;
      readonly orgId: string;
      readonly invitationId: string;
    }) =>
      attempt(
        auth.api.cancelInvitation({
          headers: headers(input.cookie),
          body: { invitationId: input.invitationId },
        }),
      ),

    adminDeleteClient: (input: { readonly cookie: string; readonly clientId: string }) =>
      attempt(
        auth.api.deleteOAuthClient({
          headers: headers(input.cookie),
          body: { client_id: input.clientId },
        }),
      ),
  };
};
