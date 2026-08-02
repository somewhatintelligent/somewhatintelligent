"use client";

import * as React from "react";

import { useDebouncedValue } from "@si/ui/hooks/use-debounced-value";

export interface WikilinkSuggestion {
  slug: string;
  title: string;
}

export interface WikilinkMatch {
  /** The text typed after the opening `[[`, up to the caret. */
  query: string;
  /** Index of the opening `[[`. */
  start: number;
  /** Caret index (end of the query). */
  end: number;
}

/**
 * Detect an unclosed `[[query` immediately before the caret. Returns null when
 * there is no open wikilink — a closing `]]`, a newline, or a nested `[`
 * between the `[[` and the caret ends the candidate.
 */
export function detectWikilink(text: string, caret: number): WikilinkMatch | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (/[[\]\n]/.test(query)) return null;
  return { query, start, end: caret };
}

/** Replace the open wikilink with a completed `[[slug]]`, returning the new text + caret. */
export function applyWikilinkInsertion(
  text: string,
  match: WikilinkMatch,
  suggestion: WikilinkSuggestion,
): { value: string; caret: number } {
  const insertion = `[[${suggestion.slug}]]`;
  return {
    value: text.slice(0, match.start) + insertion + text.slice(match.end),
    caret: match.start + insertion.length,
  };
}

export interface UseWikilinkAutocompleteOptions {
  /** Current textarea value. */
  value: string;
  /** Caret position (selectionStart); null while unfocused. */
  caret: number | null;
  /** Async provider for `[[` completions. Rejections render as no results. */
  getSuggestions: (query: string) => Promise<WikilinkSuggestion[]>;
  /** Apply the chosen completion (update value + caret). */
  onInsert: (next: { value: string; caret: number }) => void;
  /** Suppress detection while an IME composition is active. */
  composing?: boolean;
  /** Debounce for the suggestion provider. Default 150ms. */
  debounceMs?: number;
}

export interface UseWikilinkAutocompleteResult {
  open: boolean;
  query: string;
  suggestions: WikilinkSuggestion[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Insert a suggestion for the current match. */
  select: (suggestion: WikilinkSuggestion) => void;
  /** Close the popover until the query changes. */
  dismiss: () => void;
  /** Textarea keydown handler; returns true when it consumed the event. */
  handleKeyDown: (event: React.KeyboardEvent) => boolean;
}

/**
 * Headless `[[wikilink]]` autocomplete for a textarea: tracks the open match at
 * the caret, fetches suggestions, and drives keyboard selection. Stays closed
 * mid-IME-composition so composing candidates never trigger a completion.
 */
export function useWikilinkAutocomplete({
  value,
  caret,
  getSuggestions,
  onInsert,
  composing = false,
  debounceMs = 150,
}: UseWikilinkAutocompleteOptions): UseWikilinkAutocompleteResult {
  const [suggestions, setSuggestions] = React.useState<WikilinkSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dismissedKey, setDismissedKey] = React.useState<string | null>(null);

  const getSuggestionsRef = React.useRef(getSuggestions);
  const onInsertRef = React.useRef(onInsert);
  React.useEffect(() => {
    getSuggestionsRef.current = getSuggestions;
    onInsertRef.current = onInsert;
  });

  const match = React.useMemo(
    () => (caret === null || composing ? null : detectWikilink(value, caret)),
    [value, caret, composing],
  );
  const matchKey = match ? `${match.start}:${match.query}` : null;
  const query = match?.query ?? "";
  const debouncedQuery = useDebouncedValue(query, debounceMs);
  const active = match !== null && matchKey !== dismissedKey;

  React.useEffect(() => {
    if (!active) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    getSuggestionsRef
      .current(debouncedQuery)
      .then((items) => {
        if (cancelled) return;
        setSuggestions(items);
        setActiveIndex(0);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active, debouncedQuery]);

  const open = active && suggestions.length > 0;

  const select = React.useCallback(
    (suggestion: WikilinkSuggestion) => {
      if (!match) return;
      onInsertRef.current(applyWikilinkInsertion(value, match, suggestion));
      setSuggestions([]);
    },
    [match, value],
  );

  const dismiss = React.useCallback(() => {
    if (matchKey) setDismissedKey(matchKey);
  }, [matchKey]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (!open) return false;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((i) => (i + 1) % suggestions.length);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return true;
        case "Enter":
        case "Tab": {
          const active = suggestions[activeIndex];
          if (active === undefined) return false;
          event.preventDefault();
          select(active);
          return true;
        }
        case "Escape":
          event.preventDefault();
          dismiss();
          return true;
        default:
          return false;
      }
    },
    [open, suggestions, activeIndex, select, dismiss],
  );

  return { open, query, suggestions, activeIndex, setActiveIndex, select, dismiss, handleKeyDown };
}
