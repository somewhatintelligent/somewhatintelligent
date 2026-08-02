"use client";

import { useCallback } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@si/ui/lib/utils";
import { InputGroupAddon, InputGroupButton, InputGroupText } from "@si/ui/components/input-group";
import { useEditorContext } from "./editor-context";
import type { LineNumberMode, EditorStoreState } from "./editor-store";

const lineNumberCycle: LineNumberMode[] = ["absolute", "relative", "off"];
const lineNumberLabels: Record<LineNumberMode, string> = {
  absolute: "Ln#",
  relative: "Rel#",
  off: "No#",
};

function EditorStatusBar({ className }: { className?: string }) {
  const ctx = useEditorContext();

  const { wordCount, charCount, cursorLine, cursorColumn, lineNumberMode } = useStore(
    ctx.store,
    useShallow((s: EditorStoreState) => ({
      wordCount: s.wordCount,
      charCount: s.charCount,
      cursorLine: s.cursorLine,
      cursorColumn: s.cursorColumn,
      lineNumberMode: s.lineNumberMode,
    })),
  );

  const cycleLineNumbers = useCallback(() => {
    const current = ctx.store.getState().lineNumberMode;
    const idx = lineNumberCycle.indexOf(current);
    const next = lineNumberCycle[(idx + 1) % lineNumberCycle.length];
    ctx.store.setState({ lineNumberMode: next });
  }, [ctx.store]);

  return (
    <InputGroupAddon align="block-end" className={cn("flex items-center gap-3", className)}>
      <InputGroupText className="text-xs">
        {wordCount} words · {charCount} chars
      </InputGroupText>
      <div className="flex-1" />
      <InputGroupText className="text-xs">
        Ln {cursorLine}, Col {cursorColumn}
      </InputGroupText>
      <InputGroupButton
        size="xs"
        variant={lineNumberMode !== "off" ? "default" : "ghost"}
        onClick={cycleLineNumbers}
        className="font-mono text-[0.65rem]"
      >
        {lineNumberLabels[lineNumberMode]}
      </InputGroupButton>
      <InputGroupText className="text-xs">Markdown</InputGroupText>
    </InputGroupAddon>
  );
}

export { EditorStatusBar };
