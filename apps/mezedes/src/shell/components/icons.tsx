import type { ReactElement, ReactNode } from "react";

/**
 * Line icons, drawn here rather than pulled in: a handful of glyphs are not
 * worth a dependency, and `currentColor` is what keeps them on the token
 * palette.
 */

interface IconProps {
  readonly size?: number;
}

const Glyph = ({
  size,
  solid = false,
  children,
}: {
  readonly size: number;
  readonly solid?: boolean;
  readonly children: ReactNode;
}): ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={solid ? "currentColor" : "none"}
    stroke={solid ? "none" : "currentColor"}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/** The theme control. A sun with spoked rays, per the design's header. */
export const SunIcon = ({ size = 20 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="3.4" />
    <path d="M12 2.4v2.6M12 19v2.6M2.4 12h2.6M19 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
  </Glyph>
);

/** The open mezes's controls. Sits where nothing sits on the collection. */
export const GearIcon = ({ size = 20 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.6h0a1.7 1.7 0 0 1 1.7 1.7v.5a1.5 1.5 0 0 0 2.5 1.1l.4-.4a1.7 1.7 0 1 1 2.4 2.4l-.4.4a1.5 1.5 0 0 0 1.1 2.5h.5a1.7 1.7 0 0 1 0 3.4h-.5a1.5 1.5 0 0 0-1.1 2.5l.4.4a1.7 1.7 0 1 1-2.4 2.4l-.4-.4a1.5 1.5 0 0 0-2.5 1.1v.5a1.7 1.7 0 0 1-3.4 0v-.5a1.5 1.5 0 0 0-2.5-1.1l-.4.4a1.7 1.7 0 1 1-2.4-2.4l.4-.4a1.5 1.5 0 0 0-1.1-2.5h-.5a1.7 1.7 0 0 1 0-3.4h.5a1.5 1.5 0 0 0 1.1-2.5l-.4-.4a1.7 1.7 0 1 1 2.4-2.4l.4.4a1.5 1.5 0 0 0 2.5-1.1v-.5A1.7 1.7 0 0 1 12 2.6z" />
  </Glyph>
);

export const ExternalIcon = ({ size = 18 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-8.5 8.5" />
    <path d="M18.5 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h4.5" />
  </Glyph>
);

export const RefreshIcon = ({ size = 18 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <path d="M20.4 12a8.4 8.4 0 1 1-2.5-6" />
    <path d="M20.6 3.4v5h-5" />
  </Glyph>
);

export const CloseIcon = ({ size = 20 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Glyph>
);

/** The live marker: filled disc, cut check. */
export const CheckIcon = ({ size = 20 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
    <path d="M7.8 12.3l2.9 2.9 5.5-6.2" stroke="var(--mz-paper-strong)" strokeWidth={2} />
  </Glyph>
);

export const FolderIcon = ({ size = 17 }: IconProps): ReactElement => (
  <Glyph size={size}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.8 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H4.5A1.5 1.5 0 0 1 3 17.5z" />
  </Glyph>
);

const EXTENSION_GLYPH: Readonly<Record<string, string>> = {
  ts: "TS",
  tsx: "TS",
  js: "JS",
  jsx: "JS",
  mjs: "JS",
  cjs: "JS",
  css: "#",
  html: "<>",
  htm: "<>",
  json: "{ }",
  md: "¶",
  svg: "◇",
};

/**
 * The file tree's per-extension mark. Set in type rather than drawn, because
 * the extension is the useful thing to read.
 */
export const FileGlyph = ({ path }: { readonly path: string }): ReactElement => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const glyph = EXTENSION_GLYPH[extension] ?? "•";
  const boxed = glyph === "TS" || glyph === "JS";
  return (
    <span className={boxed ? "mz-glyph mz-glyph-boxed" : "mz-glyph"} aria-hidden="true">
      {glyph}
    </span>
  );
};
