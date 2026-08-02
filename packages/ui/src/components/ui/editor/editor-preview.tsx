"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { cn } from "@si/ui/lib/utils";
import { useDebouncedValue } from "@si/ui/hooks/use-debounced-value";
import { renderMarkdown } from "@si/ui/lib/markdown-render";
import { useEditorContext } from "./editor-context";

export interface EditorPreviewProps {
  className?: string;
}

/**
 * Live markdown preview. Debounces the doc, then renders the render-safe HTML
 * approximation via `dangerouslySetInnerHTML` in a `prose` container. This is
 * NOT the canonical render (that is the signed Site round-trip) — it is a
 * lightweight in-editor preview.
 */
function EditorPreview({ className }: EditorPreviewProps) {
  const ctx = useEditorContext();
  const doc = useStore(ctx.store, (s) => s.doc);
  const debouncedDoc = useDebouncedValue(doc, 200);
  const html = useMemo(() => renderMarkdown(debouncedDoc), [debouncedDoc]);

  return (
    <div
      data-slot="editor-preview"
      className={cn(
        "flex-1 min-h-0 overflow-y-auto p-4 prose max-w-none text-muted-foreground",
        className,
      )}
    >
      {debouncedDoc.trim() ? (
        // eslint-disable-next-line react/no-danger -- render-safe HTML (html:false markdown-it, see markdown-render.ts)
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-muted-foreground italic">Nothing to preview</p>
      )}
    </div>
  );
}

export { EditorPreview };
