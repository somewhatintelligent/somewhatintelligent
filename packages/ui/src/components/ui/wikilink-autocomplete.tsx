"use client";

import * as React from "react";

import { cn } from "@si/ui/lib/utils";
import type { WikilinkSuggestion } from "@si/ui/hooks/use-wikilink-autocomplete";

export type { WikilinkSuggestion };

export interface WikilinkAutocompleteProps {
  open: boolean;
  suggestions: WikilinkSuggestion[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (suggestion: WikilinkSuggestion) => void;
  id?: string;
  className?: string;
}

/**
 * Listbox of `[[wikilink]]` completions, positioned under its relatively-placed
 * container. Pair with {@link useWikilinkAutocomplete} for the detection and
 * keyboard wiring; the hook owns state, this only draws it.
 */
function WikilinkAutocomplete({
  open,
  suggestions,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  id,
  className,
}: WikilinkAutocompleteProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      id={id}
      role="listbox"
      className={cn(
        "absolute z-50 mt-1 max-h-60 w-72 overflow-auto rounded-sm border-2 border-border-strong bg-surface-raised shadow-soft-md",
        className,
      )}
    >
      {suggestions.map((suggestion, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={suggestion.slug}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              // Beat the textarea blur so the selection resolves.
              e.preventDefault();
              onSelect(suggestion);
            }}
            onMouseMove={() => {
              if (index !== activeIndex) onActiveIndexChange(index);
            }}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 px-3 py-2",
              active && "bg-accent text-accent-foreground",
            )}
          >
            <span className="text-sm font-medium">{suggestion.title}</span>
            <span className="text-xs text-muted-foreground/80">{suggestion.slug}</span>
          </div>
        );
      })}
    </div>
  );
}

export { WikilinkAutocomplete };
