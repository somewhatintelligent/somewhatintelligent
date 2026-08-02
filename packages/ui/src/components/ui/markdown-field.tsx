"use client";

import * as React from "react";

import { cn } from "@si/ui/lib/utils";
import {
  useWikilinkAutocomplete,
  type WikilinkSuggestion,
} from "@si/ui/hooks/use-wikilink-autocomplete";
import { Textarea } from "./textarea";
import { WikilinkAutocomplete } from "./wikilink-autocomplete";

export interface MarkdownFieldStats {
  chars: number;
  words: number;
}

export interface MarkdownFieldProps extends Omit<
  React.ComponentProps<"textarea">,
  "value" | "onChange" | "children"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Spaces inserted on Tab / stripped on Shift+Tab. Default 2. */
  indentWidth?: number;
  /** Rendered under the editor — a node, or a fn given the live char/word counts. */
  footer?: React.ReactNode | ((stats: MarkdownFieldStats) => React.ReactNode);
  /** Turnkey `[[wikilink]]` autocomplete — an async slug/title provider. */
  wikilink?: (query: string) => Promise<WikilinkSuggestion[]>;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function indentSelection(text: string, start: number, end: number, unit: string) {
  if (start === end) {
    return {
      value: text.slice(0, start) + unit + text.slice(start),
      start: start + unit.length,
      end: start + unit.length,
    };
  }
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const block = text.slice(lineStart, end);
  const indented = block.replace(/^/gm, unit);
  const added = indented.length - block.length;
  return {
    value: text.slice(0, lineStart) + indented + text.slice(end),
    start: start + unit.length,
    end: end + added,
  };
}

function outdentSelection(text: string, start: number, end: number, unit: string) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const block = text.slice(lineStart, end);
  const re = new RegExp(`^ {1,${unit.length}}`, "gm");
  let firstRemoved = 0;
  let totalRemoved = 0;
  const outdented = block.replace(re, (m: string, offset: number) => {
    if (offset === 0) firstRemoved = m.length;
    totalRemoved += m.length;
    return "";
  });
  return {
    value: text.slice(0, lineStart) + outdented + text.slice(end),
    start: Math.max(lineStart, start - firstRemoved),
    end: end - totalRemoved,
  };
}

const NO_SUGGESTIONS = async (): Promise<WikilinkSuggestion[]> => [];

/**
 * Controlled, textarea-based markdown editor for long-form bodies: monospace,
 * auto-growing, with Tab-to-indent, a char/word count-aware footer slot, and an
 * optional inline `[[wikilink]]` autocomplete. Renders no markdown preview —
 * that is a rendering-surface concern.
 */
function MarkdownField({
  value,
  onValueChange,
  indentWidth = 2,
  footer,
  wikilink,
  className,
  disabled,
  ref,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: MarkdownFieldProps) {
  const innerRef = React.useRef<HTMLTextAreaElement>(null);
  const pendingSelection = React.useRef<number | null>(null);
  const [caret, setCaret] = React.useState<number | null>(null);
  const [composing, setComposing] = React.useState(false);
  const listboxId = React.useId();

  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const wl = useWikilinkAutocomplete({
    value,
    caret,
    getSuggestions: wikilink ?? NO_SUGGESTIONS,
    composing,
    onInsert: ({ value: next, caret: nextCaret }) => {
      pendingSelection.current = nextCaret;
      setCaret(nextCaret);
      onValueChange(next);
    },
  });
  const wikilinkOpen = wikilink != null && wl.open;

  // Restore the caret after a programmatic edit (Tab, wikilink insertion),
  // once the controlled value has flushed to the DOM.
  React.useLayoutEffect(() => {
    if (pendingSelection.current === null) return;
    const el = innerRef.current;
    const pos = pendingSelection.current;
    pendingSelection.current = null;
    if (el) {
      el.selectionStart = pos;
      el.selectionEnd = pos;
    }
  }, [value]);

  function syncCaret(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (wl.handleKeyDown(e)) return;
    if (e.key === "Tab") {
      const el = e.currentTarget;
      const unit = " ".repeat(indentWidth);
      const next = e.shiftKey
        ? outdentSelection(value, el.selectionStart, el.selectionEnd, unit)
        : indentSelection(value, el.selectionStart, el.selectionEnd, unit);
      if (next.value === value) return;
      e.preventDefault();
      pendingSelection.current = next.end;
      setCaret(next.end);
      onValueChange(next.value);
      // Restore the full selection range (not just the caret) after the flush.
      requestAnimationFrame(() => {
        const node = innerRef.current;
        if (node) {
          node.selectionStart = next.start;
          node.selectionEnd = next.end;
        }
      });
    }
  }

  const stats: MarkdownFieldStats = { chars: value.length, words: countWords(value) };
  const footerContent = typeof footer === "function" ? footer(stats) : footer;

  return (
    <div className="relative flex flex-col gap-1.5">
      <Textarea
        ref={setRef}
        value={value}
        disabled={disabled}
        className={cn("min-h-40 font-mono text-sm leading-relaxed", className)}
        role={wikilink != null ? "combobox" : undefined}
        aria-expanded={wikilink != null ? wikilinkOpen : undefined}
        aria-controls={wikilink != null ? listboxId : undefined}
        aria-autocomplete={wikilink != null ? "list" : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onCompositionStart={(e) => {
          setComposing(true);
          onCompositionStart?.(e);
        }}
        onCompositionEnd={(e) => {
          setComposing(false);
          syncCaret(e.currentTarget);
          onCompositionEnd?.(e);
        }}
        {...props}
      />
      {wikilink != null && (
        <WikilinkAutocomplete
          id={listboxId}
          open={wikilinkOpen}
          suggestions={wl.suggestions}
          activeIndex={wl.activeIndex}
          onActiveIndexChange={wl.setActiveIndex}
          onSelect={wl.select}
        />
      )}
      {footerContent != null && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {footerContent}
        </div>
      )}
    </div>
  );
}

export { MarkdownField, countWords };
