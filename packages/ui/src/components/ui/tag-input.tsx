"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import { cn } from "@si/ui/lib/utils";
import { Badge } from "./badge";

export interface TagInputProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Optional pool filtered as you type into a suggestion dropdown. */
  suggestions?: string[];
  /** Hard cap on the number of tags. */
  maxTags?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

const hasTag = (tags: string[], candidate: string) =>
  tags.some((t) => t.toLowerCase() === candidate.toLowerCase());

/**
 * Chip-based multi-tag input: type + Enter/comma to add, Backspace on an empty
 * field to remove the last chip, click a chip's X to remove it. Dedupes
 * case-insensitively and offers an optional as-you-type suggestion listbox.
 */
export function TagInput({
  value,
  onValueChange,
  suggestions,
  maxTags,
  placeholder,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: TagInputProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const reactId = React.useId();
  const listboxId = `${id ?? reactId}-listbox`;

  const atCapacity = maxTags != null && value.length >= maxTags;

  const filtered = React.useMemo(() => {
    if (!suggestions) return [];
    const q = query.trim().toLowerCase();
    return suggestions.filter(
      (s) => !hasTag(value, s) && (q === "" || s.toLowerCase().includes(q)),
    );
  }, [suggestions, query, value]);

  const showDropdown = open && !atCapacity && filtered.length > 0;

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag || atCapacity || hasTag(value, tag)) {
      setQuery("");
      return;
    }
    onValueChange([...value, tag]);
    setQuery("");
    setActiveIndex(-1);
  }

  function removeTag(index: number) {
    onValueChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "Enter":
      case ",":
        e.preventDefault();
        if (showDropdown && activeIndex >= 0 && filtered[activeIndex] !== undefined)
          addTag(filtered[activeIndex]);
        else addTag(query);
        break;
      case "Backspace":
        if (query === "" && value.length > 0) {
          e.preventDefault();
          removeTag(value.length - 1);
        }
        break;
      case "ArrowDown":
        if (showDropdown) {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filtered.length);
        }
        break;
      case "ArrowUp":
        if (showDropdown) {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-sm border-2 border-border-strong bg-surface-raised px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25",
          disabled && "cursor-not-allowed opacity-50",
          ariaInvalid &&
            "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        )}
        onMouseDown={(e) => {
          // Clicking the shell (not a chip button) focuses the input.
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {value.map((tag, index) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            <span>{tag}</span>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={`Remove ${tag}`}
              className="inline-flex items-center justify-center rounded-xs text-secondary-foreground/70 hover:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => removeTag(index)}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          value={query}
          disabled={disabled || atCapacity}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
        />
      </div>
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-sm border-2 border-border-strong bg-surface-raised shadow-soft-md"
        >
          {filtered.map((suggestion, index) => (
            <div
              key={suggestion}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                index === activeIndex && "bg-accent text-accent-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(suggestion);
              }}
              onMouseMove={() => {
                if (index !== activeIndex) setActiveIndex(index);
              }}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
