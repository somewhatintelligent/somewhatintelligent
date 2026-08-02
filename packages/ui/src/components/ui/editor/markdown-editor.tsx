"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useStore } from "zustand";
import { cn } from "@si/ui/lib/utils";
import { useControlledState } from "@si/ui/hooks/use-controlled-state";
import {
  useWikilinkAutocomplete,
  detectWikilink,
  type WikilinkSuggestion,
} from "@si/ui/hooks/use-wikilink-autocomplete";
import { WikilinkAutocomplete } from "@si/ui/components/wikilink-autocomplete";
import { useMarkdownEditor } from "./use-markdown-editor.client";
import { EditorToolbar } from "./editor-toolbar";
import { EditorSource } from "./editor-codemirror.client";
import { EditorStatusBar } from "./editor-status-bar";
import {
  MarkdownEditorContext,
  type EditorMode,
  type MarkdownEditorContextValue,
} from "./editor-context";

const EditorPreview = lazy(() =>
  import("./editor-preview").then((m) => ({ default: m.EditorPreview })),
);

export interface MarkdownEditorProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  mode?: EditorMode;
  defaultMode?: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  children?: React.ReactNode;
  /** Whether the editor takes over the viewport (controlled). */
  fullscreen?: boolean;
  defaultFullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Turnkey `[[wikilink]]` autocomplete — an async slug/title provider. */
  wikilink?: (query: string) => Promise<WikilinkSuggestion[]>;
}

function EditorSplit({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      data-slot="editor-split"
      className={cn("flex flex-1 min-h-0 divide-x divide-border", className)}
    >
      {children}
    </div>
  );
}

// Handlers the CodeMirror keymap reaches for while the wikilink popover is open.
// Held in a ref so a single mount-time `Prec.highest` keymap can dispatch to the
// live React state without the extension re-registering.
interface WikilinkActions {
  open: boolean;
  down: () => void;
  up: () => void;
  select: () => void;
  dismiss: () => void;
}

function MarkdownEditor({
  value: valueProp,
  defaultValue = "",
  onChange,
  mode: modeProp,
  defaultMode = "split",
  onModeChange,
  readOnly = false,
  placeholder,
  className,
  children,
  fullscreen: fullscreenProp,
  defaultFullscreen = false,
  onFullscreenChange,
  wikilink,
}: MarkdownEditorProps) {
  const [mode, setMode] = useControlledState({
    value: modeProp,
    defaultValue: defaultMode,
    onChange: onModeChange,
  });

  const [fullscreen, setFullscreen] = useControlledState({
    value: fullscreenProp,
    defaultValue: defaultFullscreen,
    onChange: onFullscreenChange,
  });

  const wikilinkEnabled = wikilink != null;
  const wlActionsRef = useRef<WikilinkActions | null>(null);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);

  // Mount-time extensions: a high-precedence keymap that lets the wikilink
  // popover claim Arrow/Enter/Tab/Escape before CodeMirror's own bindings, plus
  // composition tracking so `[[` detection pauses mid-IME.
  const extensions = useMemo(() => {
    if (!wikilinkEnabled) return [];
    const intercept = (fn: (a: WikilinkActions) => void) => () => {
      const a = wlActionsRef.current;
      if (!a || !a.open) return false;
      fn(a);
      return true;
    };
    return [
      Prec.highest(
        keymap.of([
          { key: "ArrowDown", run: intercept((a) => a.down()) },
          { key: "ArrowUp", run: intercept((a) => a.up()) },
          { key: "Enter", run: intercept((a) => a.select()) },
          { key: "Tab", run: intercept((a) => a.select()) },
          { key: "Escape", run: intercept((a) => a.dismiss()) },
        ]),
      ),
      EditorView.domEventHandlers({
        compositionstart: () => {
          composingRef.current = true;
          setComposing(true);
          return false;
        },
        compositionend: () => {
          composingRef.current = false;
          setComposing(false);
          return false;
        },
      }),
    ];
  }, [wikilinkEnabled]);

  const { containerRef, store, viewRef, setDoc } = useMarkdownEditor({
    defaultValue,
    onChange,
    readOnly,
    placeholder,
    extensions,
  });

  useEffect(() => {
    if (valueProp !== undefined) {
      setDoc(valueProp);
    }
  }, [valueProp, setDoc]);

  const ctx = useMemo<MarkdownEditorContextValue>(
    () => ({
      store,
      containerRef,
      get viewCurrent() {
        return viewRef.current;
      },
      mode,
      setMode,
      readOnly,
      fullscreen,
      setFullscreen,
    }),
    [store, containerRef, viewRef, mode, setMode, readOnly, fullscreen, setFullscreen],
  );

  // ── Wikilink bridge: drive the shared hook from CM-derived value+caret ────────
  const doc = useStore(store, (s) => s.doc);
  const caret = useStore(store, (s) => s.caret);
  const panesRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const wl = useWikilinkAutocomplete({
    value: doc,
    caret: wikilinkEnabled ? caret : null,
    getSuggestions: wikilink ?? (async () => []),
    composing,
    onInsert: ({ value, caret: nextCaret }) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: nextCaret },
      });
      view.focus();
    },
  });

  const wlOpen = wikilinkEnabled && wl.open;

  // Keep the ref the CM keymap reads in sync with the live hook state.
  wlActionsRef.current = {
    open: wlOpen,
    down: () => wl.setActiveIndex((wl.activeIndex + 1) % Math.max(wl.suggestions.length, 1)),
    up: () =>
      wl.setActiveIndex(
        (wl.activeIndex - 1 + wl.suggestions.length) % Math.max(wl.suggestions.length, 1),
      ),
    select: () => {
      const active = wl.suggestions[wl.activeIndex];
      if (active) wl.select(active);
    },
    dismiss: () => wl.dismiss(),
  };

  // Anchor the popover under the caret, relative to the panes container.
  useEffect(() => {
    if (!wlOpen) {
      setPopoverPos(null);
      return;
    }
    const view = viewRef.current;
    const container = panesRef.current;
    if (!view || !container) return;
    const match = detectWikilink(doc, caret);
    const coords = view.coordsAtPos(match ? match.start : caret);
    if (!coords) return;
    const rect = container.getBoundingClientRect();
    setPopoverPos({ top: coords.bottom - rect.top, left: coords.left - rect.left });
  }, [wlOpen, doc, caret, viewRef]);

  // ── Fullscreen: body-scroll lock + focus restore + Escape-to-exit ─────────────
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!fullscreen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      // The wikilink popover claims Escape first (CM keymap preventDefaults it),
      // so only a non-consumed Escape exits fullscreen.
      if (e.key === "Escape" && !e.defaultPrevented) {
        setFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [fullscreen, setFullscreen]);

  const hasChildren = children !== undefined && children !== null;

  return (
    <MarkdownEditorContext.Provider value={ctx}>
      {/* Plain wrapper instead of InputGroup — InputGroup's block-align variants
          force the container to collapse to content height, which fights any
          consumer-supplied height/flex sizing. The toolbar and status bar still
          render as InputGroupAddons inside; we only drop the outer wrapper. */}
      <div
        data-slot="markdown-editor"
        data-mode={mode}
        data-fullscreen={fullscreen || undefined}
        className={cn(
          "relative flex w-full min-w-0 flex-col rounded-sm border-2 border-border-strong bg-surface-raised outline-none transition-[border-color,box-shadow] has-disabled:bg-input/50 has-disabled:opacity-50",
          fullscreen && "fixed inset-0 z-50 h-screen w-screen rounded-none bg-background",
          className,
        )}
      >
        {hasChildren ? (
          children
        ) : (
          <>
            <EditorToolbar />
            <div
              ref={panesRef}
              data-slot="editor-panes"
              data-mode={mode}
              className="relative flex flex-1 min-h-0 data-[mode=split]:divide-x data-[mode=split]:divide-border"
            >
              <EditorSource className={mode === "preview" ? "hidden" : undefined} />
              <Suspense>
                <EditorPreview className={mode === "write" ? "hidden" : undefined} />
              </Suspense>
              {wlOpen && popoverPos && (
                <div
                  className="absolute z-50"
                  style={{ top: popoverPos.top, left: popoverPos.left }}
                >
                  <WikilinkAutocomplete
                    open
                    suggestions={wl.suggestions}
                    activeIndex={wl.activeIndex}
                    onActiveIndexChange={wl.setActiveIndex}
                    onSelect={wl.select}
                    className="relative mt-0"
                  />
                </div>
              )}
            </div>
            <EditorStatusBar />
          </>
        )}
      </div>
    </MarkdownEditorContext.Provider>
  );
}

MarkdownEditor.Toolbar = EditorToolbar;
MarkdownEditor.Source = EditorSource;
MarkdownEditor.Preview = EditorPreview;
MarkdownEditor.StatusBar = EditorStatusBar;
MarkdownEditor.Split = EditorSplit;

export {
  MarkdownEditorContext,
  type EditorMode,
  type MarkdownEditorContextValue,
} from "./editor-context";
export { useEditorContext } from "./editor-context";
export { EditorPreview as EditorPreviewEager } from "./editor-preview";
export type { WikilinkSuggestion } from "@si/ui/hooks/use-wikilink-autocomplete";
export type { Extension } from "@codemirror/state";
export { MarkdownEditor, EditorToolbar, EditorSource, EditorPreview, EditorStatusBar, EditorSplit };
