"use client";

import { createContext, useContext } from "react";
import type { EditorStore } from "./editor-store";
import type { EditorView } from "@codemirror/view";

export type EditorMode = "write" | "preview" | "split";

export interface MarkdownEditorContextValue {
  store: EditorStore;
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewCurrent: EditorView | null;
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  readOnly: boolean;
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
}

export const MarkdownEditorContext = createContext<MarkdownEditorContextValue | null>(null);

export function useEditorContext(): MarkdownEditorContextValue {
  const ctx = useContext(MarkdownEditorContext);
  if (!ctx) throw new Error("Editor components must be used within MarkdownEditor");
  return ctx;
}
