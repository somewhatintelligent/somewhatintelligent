/**
 * The shell's whole view of the server. Everything goes through `/api`, which
 * Access already gates; R2 and the Durable Object are the Worker's business and
 * a browser never addresses either.
 */

export type Visibility = "private" | "public";

/** The fields every mezes response carries, whatever else is attached to it. */
export interface MezesRecord {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The live artifact URL. Only resolves while the mezes is public. */
  readonly url: string;
  readonly visibility: Visibility;
  readonly head: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MezesSummary extends MezesRecord {
  readonly versions: readonly number[];
}

export interface VersionSummary {
  readonly n: number;
  readonly at: number;
  readonly note: string;
}

export interface MezesDetail extends MezesRecord {
  readonly versions: readonly VersionSummary[];
}

export interface FileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha: string;
}

class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail === "" ? `request failed with ${status}` : detail);
    this.status = status;
  }
}

/** Whatever went wrong, the screen says it rather than swallowing it. */
export const failureText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

interface Options {
  readonly method?: string;
  readonly body?: unknown;
}

const send = async (path: string, options: Options, accept: string): Promise<Response> => {
  const headers: Record<string, string> = { Accept: accept };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  // A 401 here means Access let the document through and then expired, so the
  // body is the Worker's denial and worth showing rather than swallowing.
  if (!response.ok)
    throw new ApiError(response.status, (await response.text()).trim().slice(0, 400));
  return response;
};

const json = async <T>(path: string, options: Options = {}): Promise<T> =>
  (await (await send(path, options, "application/json")).json()) as T;

const slugPath = (slug: string): string => `/api/mezedes/${encodeURIComponent(slug)}`;

export const listMezedes = async (query: string): Promise<readonly MezesSummary[]> => {
  const search = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const { mezedes } = await json<{ mezedes: readonly MezesSummary[] }>(`/api/mezedes${search}`);
  return mezedes;
};

export const getMezes = (slug: string): Promise<MezesDetail> => json<MezesDetail>(slugPath(slug));

export const listFiles = async (slug: string, version: number): Promise<readonly FileEntry[]> => {
  const { files } = await json<{ files: readonly FileEntry[] }>(
    `${slugPath(slug)}/v/${version}/files`,
  );
  return files;
};

export const readFile = async (slug: string, version: number, path: string): Promise<string> => {
  const url = `${slugPath(slug)}/v/${version}/file?path=${encodeURIComponent(path)}`;
  return (await send(url, {}, "text/plain")).text();
};

/**
 * Returns the record, not the detail: the shell keeps the version list it
 * already has rather than depending on the patch response to carry one.
 */
export const patchMezes = (
  slug: string,
  patch: { readonly name?: string; readonly visibility?: Visibility },
): Promise<MezesRecord> => json<MezesRecord>(slugPath(slug), { method: "PATCH", body: patch });

export const deleteMezes = async (slug: string): Promise<void> => {
  await json<{ removed: boolean }>(slugPath(slug), { method: "DELETE" });
};

/**
 * The origin the preview frame loads: `p--<token>.<artifactZone>`, minted by
 * the server and owner-only because `/api` is behind Access.
 *
 * A preview is an ORIGIN and not a path under the shell, and that is not
 * cosmetic. On the shell's own hostname the frame runs on an opaque origin, so
 * its `<script type="module">` fetches cross-origin, the browser drops
 * credentials, and Access 401s the mezes's own `./client.js` before the Worker
 * sees it. The artifact zone has no Access application, and here the token in
 * the hostname is the authorisation, so a credential-less fetch is just served.
 */
export const mintPreview = async (slug: string, version: number): Promise<string> =>
  (await json<{ url: string }>(`${slugPath(slug)}/v/${version}/preview`)).url;
