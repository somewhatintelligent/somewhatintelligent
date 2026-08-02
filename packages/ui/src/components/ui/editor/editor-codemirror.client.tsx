"use client";

import { cn } from "@si/ui/lib/utils";
import { useEditorContext } from "./editor-context";

function EditorSource({ className }: { className?: string }) {
  const ctx = useEditorContext();

  return (
    <div
      ref={ctx.containerRef}
      data-slot="editor-source"
      data-slot-control="input-group-control"
      className={cn(
        "flex-1 min-h-0 overflow-auto [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-content]:px-3",
        className,
      )}
    />
  );
}

export { EditorSource };
