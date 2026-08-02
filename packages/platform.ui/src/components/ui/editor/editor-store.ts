import { createStore } from "zustand/vanilla";

export type LineNumberMode = "absolute" | "relative" | "off";

export interface EditorStoreState {
  doc: string;
  /** Absolute caret offset into the doc (selection.main.head). */
  caret: number;
  cursorLine: number;
  cursorColumn: number;
  wordCount: number;
  charCount: number;
  lineNumberMode: LineNumberMode;
}

function countWords(text: string): number {
  let count = 0;
  const re = /\S+/g;
  while (re.exec(text)) count++;
  return count;
}

let wordCountTimer: ReturnType<typeof setTimeout> | null = null;

export function createEditorStore(initialDoc: string) {
  return createStore<EditorStoreState>()(() => ({
    doc: initialDoc,
    caret: 0,
    cursorLine: 1,
    cursorColumn: 1,
    wordCount: countWords(initialDoc),
    charCount: initialDoc.length,
    lineNumberMode: "absolute",
  }));
}

export function setStoreDoc(store: EditorStore, doc: string) {
  if (store.getState().doc === doc) return;
  store.setState({ doc, charCount: doc.length });

  if (wordCountTimer) clearTimeout(wordCountTimer);
  wordCountTimer = setTimeout(() => {
    store.setState({ wordCount: countWords(doc) });
  }, 200);
}

export type EditorStore = ReturnType<typeof createEditorStore>;
