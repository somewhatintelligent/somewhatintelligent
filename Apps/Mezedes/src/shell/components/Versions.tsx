import { useEffect, useMemo, type ReactElement } from "react";
import type { VersionSummary } from "./api.ts";
import { Sprig } from "./artwork.tsx";
import { longAge, shortAge } from "./format.ts";
import { CheckIcon, CloseIcon, RefreshIcon } from "./icons.tsx";

/**
 * A right sheet on desktop, a bottom sheet on mobile — one markup, the media
 * query does the rest. Selecting a version re-points the preview and the code
 * view without navigating away, so the URL keeps naming the mezes.
 */

interface VersionsProps {
  readonly open: boolean;
  readonly slug: string;
  readonly head: number;
  readonly versions: readonly VersionSummary[];
  /** `null` is the live version, which is whatever `head` currently is. */
  readonly selected: number | null;
  readonly onSelect: (version: number | null) => void;
  readonly onClose: () => void;
}

export const Versions = ({
  open,
  slug,
  head,
  versions,
  selected,
  onSelect,
  onClose,
}: VersionsProps): ReactElement => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const ordered = useMemo(() => [...versions].sort((left, right) => right.n - left.n), [versions]);

  return (
    <>
      {/* A real button: closing by clicking away has to be reachable from the
          keyboard too, and `visibility` keeps it out of the tab order when the
          sheet is shut. */}
      <button
        type="button"
        className={open ? "mz-scrim is-open" : "mz-scrim"}
        aria-label="Close versions"
        onClick={onClose}
      />
      <aside
        className={open ? "mz-sheet is-open" : "mz-sheet"}
        aria-label="versions"
        aria-hidden={!open}
      >
        <span className="mz-sheet-grip" aria-hidden="true" />
        <div className="mz-sheet-head">
          <h2>versions</h2>
          <button
            type="button"
            className="mz-icon-action"
            onClick={onClose}
            aria-label="Close versions"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mz-version-list">
          <button
            type="button"
            className="mz-version is-live"
            aria-current={selected === null}
            onClick={() => {
              onSelect(null);
            }}
          >
            <span className="mz-version-mark">
              <CheckIcon />
            </span>
            <span className="mz-version-body">
              <strong>Live</strong>
              <small>Current live version</small>
            </span>
            <Sprig slug={slug} version={head} />
          </button>

          {ordered.map((version) => (
            <button
              type="button"
              key={version.n}
              className="mz-version"
              aria-current={selected === version.n}
              onClick={() => {
                onSelect(version.n);
              }}
            >
              <span className="mz-version-mark" />
              <span className="mz-version-body">
                <strong>
                  v{version.n} <span className="mz-dot">·</span>{" "}
                  <span className="mz-age-long">{longAge(version.at)}</span>
                  <span className="mz-age-short">{shortAge(version.at)}</span>
                </strong>
                {version.note === "" ? null : <small>{version.note}</small>}
              </span>
              <Sprig slug={slug} version={version.n} />
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mz-return"
          onClick={() => {
            onSelect(null);
          }}
        >
          <RefreshIcon />
          return to live
        </button>
      </aside>
    </>
  );
};
