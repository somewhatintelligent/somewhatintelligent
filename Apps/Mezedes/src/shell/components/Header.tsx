import type { MouseEvent, ReactElement, Ref } from "react";
import { SunIcon } from "./icons.tsx";
import { isPlainClick, navigate } from "./router.ts";
import type { Theme } from "./theme.ts";

interface HeaderProps {
  /** The mezes name, when one is open. `null` on the collection. */
  readonly crumb: string | null;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
  /**
   * Receives the trailing slot, which exists only while a mezes is open. The
   * mezes hangs its own controls there rather than growing a second header —
   * this is the app's only bar.
   */
  readonly slotRef: Ref<HTMLSpanElement>;
}

export const Header = ({ crumb, theme, onToggleTheme, slotRef }: HeaderProps): ReactElement => {
  const home = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate("/");
  };

  return (
    <header className="mz-header">
      <p className="mz-brand">
        {/*
          The wordmark is the name in its own script. `lang` is what tells a
          screen reader to read it as Greek rather than spell it out as stray
          latin-adjacent glyphs, and it is why the surrounding page stays
          `lang="en"` rather than the mark going unmarked. The serif stack —
          Georgia, then Times New Roman — covers Greek; the self-hosted Manrope
          is latin and latin-ext only, so this must NOT inherit `--mz-sans`.
        */}
        <a
          className={crumb === null ? "mz-brand-root is-here" : "mz-brand-root"}
          href="/"
          lang="el"
          onClick={home}
        >
          μεζέδες
        </a>
        {crumb === null ? null : (
          <>
            <span className="mz-brand-slash" aria-hidden="true">
              /
            </span>
            <span className="mz-crumb">{crumb}</span>
          </>
        )}
      </p>

      <div className="mz-header-actions">
        <button
          type="button"
          className="mz-text-action"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
        >
          <SunIcon />
          <span className="mz-label">theme</span>
        </button>
        {crumb === null ? null : (
          <>
            <span className="mz-header-rule" aria-hidden="true" />
            <span className="mz-header-slot" ref={slotRef} />
          </>
        )}
      </div>
    </header>
  );
};
