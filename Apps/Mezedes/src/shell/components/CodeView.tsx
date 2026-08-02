import { useEffect, useMemo, useState, type ReactElement } from "react";
import { failureText, listFiles, readFile, type FileEntry } from "./api.ts";
import { FileGlyph, FolderIcon } from "./icons.tsx";
import { tokenise } from "./highlight.ts";

/** Read only, always. There is no editor here and there is not going to be one. */

interface CodeViewProps {
  readonly slug: string;
  readonly version: number;
}

interface Group {
  readonly dir: string;
  readonly files: readonly FileEntry[];
}

/** What a reader wants open first, in the order a mezes is usually written. */
const PREFERRED = [
  "src/client.tsx",
  "src/App.tsx",
  "src/app.tsx",
  "public/index.html",
  "index.html",
];

const openFirst = (files: readonly FileEntry[]): string | null => {
  for (const candidate of PREFERRED) {
    if (files.some((file) => file.path === candidate)) return candidate;
  }
  return files[0]?.path ?? null;
};

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const grouped = (files: readonly FileEntry[]): readonly Group[] => {
  const byDir = new Map<string, FileEntry[]>();
  for (const file of files) {
    const cut = file.path.lastIndexOf("/");
    const dir = cut === -1 ? "" : file.path.slice(0, cut);
    const bucket = byDir.get(dir);
    if (bucket === undefined) byDir.set(dir, [file]);
    else bucket.push(file);
  }
  // Directories in name order, then the root files — a tree reads folders first.
  return [...byDir.entries()]
    .sort((left, right) => {
      if (left[0] === right[0]) return 0;
      if (left[0] === "") return 1;
      if (right[0] === "") return -1;
      return left[0].localeCompare(right[0]);
    })
    .map(([dir, entries]) => ({
      dir,
      files: [...entries].sort((left, right) => left.path.localeCompare(right.path)),
    }));
};

export const CodeView = ({ slug, version }: CodeViewProps): ReactElement => {
  const [files, setFiles] = useState<readonly FileEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setFiles(null);
    setSelected(null);
    setSource(null);
    setFailure(null);
    listFiles(slug, version)
      .then((found) => {
        if (!current) return;
        setFiles(found);
        setSelected(openFirst(found));
      })
      .catch((cause: unknown) => {
        if (current) setFailure(failureText(cause));
      });
    return () => {
      current = false;
    };
  }, [slug, version]);

  useEffect(() => {
    if (selected === null) return undefined;
    let current = true;
    setSource(null);
    readFile(slug, version, selected)
      .then((text) => {
        if (current) setSource(text);
      })
      .catch((cause: unknown) => {
        if (current) setFailure(failureText(cause));
      });
    return () => {
      current = false;
    };
  }, [slug, version, selected]);

  const tokens = useMemo(
    () => (source === null || selected === null ? [] : tokenise(source, selected)),
    [source, selected],
  );
  const lines = useMemo(() => (source === null ? 0 : source.split("\n").length), [source]);
  const groups = useMemo(() => (files === null ? [] : grouped(files)), [files]);

  return (
    <div className="mz-code">
      <nav className="mz-tree" aria-label="Files">
        {groups.map((group) => (
          <div className="mz-tree-group" key={group.dir}>
            {group.dir === "" ? null : (
              <p className="mz-tree-dir">
                <FolderIcon />
                {group.dir}
              </p>
            )}
            {group.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className="mz-tree-file"
                aria-current={file.path === selected}
                onClick={() => {
                  setSelected(file.path);
                }}
              >
                <FileGlyph path={file.path} />
                <span className="mz-tree-name">{basename(file.path)}</span>
              </button>
            ))}
          </div>
        ))}
        {files === null && failure === null ? <p className="mz-tree-note">loading</p> : null}
      </nav>

      <div className="mz-source">
        <span className="mz-readonly">read only</span>
        {failure === null ? null : (
          <p className="mz-source-note" role="alert">
            {failure}
          </p>
        )}
        {failure === null && source === null ? <p className="mz-source-note">loading</p> : null}
        {source === null ? null : (
          <div className="mz-source-scroll">
            <div className="mz-gutter" aria-hidden="true">
              {Array.from({ length: lines }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <pre className="mz-pre">
              <code>
                {tokens.map((token, index) => (
                  <span key={index} className={`tk-${token.kind}`}>
                    {token.text}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
