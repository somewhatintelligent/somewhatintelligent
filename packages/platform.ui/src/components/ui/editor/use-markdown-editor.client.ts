"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { editorTheme } from "./editor-theme.client";
import { markdownKeymap } from "./editor-keymap";
import { createEditorStore, setStoreDoc } from "./editor-store";
import { createLineNumbers } from "./editor-line-numbers.client";

export interface UseMarkdownEditorOptions {
  defaultValue?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  // Consumer-supplied static CodeMirror extensions appended to the editor
  // state on mount. These are applied once — callers that need dynamic
  // add/remove should reach for compartments themselves.
  extensions?: Extension[];
}

export function useMarkdownEditor(options: UseMarkdownEditorOptions) {
  const {
    defaultValue = "",
    onChange,
    readOnly = false,
    placeholder = "",
    extensions: extraExtensions,
  } = options;
  // Stash consumer extensions so `useEffect` can read them on mount
  // without re-triggering when the caller passes a new array identity.
  const extraExtensionsRef = useRef(extraExtensions);
  extraExtensionsRef.current = extraExtensions;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isExternalUpdate = useRef(false);

  const lineNumbersCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const placeholderCompartment = useRef(new Compartment());

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createEditorStore(defaultValue), []);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    const initialState = store.getState();

    const state = EditorState.create({
      doc: initialState.doc,
      extensions: [
        lineNumbersCompartment.current.of(createLineNumbers(initialState.lineNumberMode)),
        keymap.of(markdownKeymap),
        keymap.of(defaultKeymap),
        keymap.of(historyKeymap),
        history(),
        markdown({ base: markdownLanguage }),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        placeholderCompartment.current.of(placeholder ? placeholderExt(placeholder) : []),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isExternalUpdate.current) {
            const doc = update.state.doc.toString();
            setStoreDoc(store, doc);
            onChangeRef.current?.(doc);
          }
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            const newLine = line.number;
            const newCol = pos - line.from + 1;
            const prev = store.getState();
            if (newLine !== prev.cursorLine || newCol !== prev.cursorColumn || pos !== prev.caret) {
              store.setState({ cursorLine: newLine, cursorColumn: newCol, caret: pos });
            }
          }
        }),
        EditorView.lineWrapping,
        ...(extraExtensionsRef.current ?? []),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    const unsub = store.subscribe((curr, prev) => {
      if (curr.lineNumberMode !== prev.lineNumberMode) {
        view.dispatch({
          effects: lineNumbersCompartment.current.reconfigure(
            createLineNumbers(curr.lineNumberMode),
          ),
        });
      }
    });

    return () => {
      unsub();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.current.reconfigure(
        placeholder ? placeholderExt(placeholder) : [],
      ),
    });
  }, [placeholder]);

  const setDoc = useCallback(
    (doc: string) => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === doc) return;
      isExternalUpdate.current = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: doc } });
      setStoreDoc(store, doc);
      isExternalUpdate.current = false;
    },
    [store],
  );

  return { containerRef, store, viewRef, setDoc };
}
