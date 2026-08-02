"use client";

import * as React from "react";

import { cn } from "@si/ui/lib/utils";
import { useDebouncedValue } from "@si/ui/hooks/use-debounced-value";
import { Input } from "./input";
import { Button } from "./button";

export interface SearchComboboxProps<T> {
  /** Pinned selection; null = nothing selected. */
  value: T | null;
  /** Called with the picked item, or null when the user clears. */
  onSelect: (item: T | null) => void;
  /** Async search. Rejections are swallowed (render as no results). */
  search: (query: string) => Promise<T[]>;
  /** Stable key per item (used for React keys + active-item tracking). */
  itemToKey: (item: T) => string;
  /** Text shown in the input when an item is pinned. */
  itemToLabel: (item: T) => string;
  /** Row renderer for the dropdown. */
  renderItem: (item: T, active: boolean) => React.ReactNode;
  /** Some options may be shown but not pickable (e.g. already provisioned). */
  isItemDisabled?: (item: T) => boolean;
  placeholder?: string;
  /** Minimum characters before searching. Default 2. */
  minChars?: number;
  /** Debounce for the search call. Default 250ms. */
  debounceMs?: number;
  disabled?: boolean;
  id?: string;
  inputType?: React.HTMLInputTypeAttribute; // default "text"
  /** Shown when a completed search returns nothing. Default "No matches." */
  emptyText?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

export function SearchCombobox<T>({
  value,
  onSelect,
  search,
  itemToKey,
  itemToLabel,
  renderItem,
  isItemDisabled,
  placeholder,
  minChars = 2,
  debounceMs = 250,
  disabled,
  id,
  inputType = "text",
  emptyText = "No matches.",
  "aria-invalid": ariaInvalid,
  className,
}: SearchComboboxProps<T>): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<T[]>([]);
  const [open, setOpen] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the (usually inline, unstable) search callback in a ref so it can be
  // read from the debounced effect without re-firing on every parent render.
  const searchRef = React.useRef(search);
  React.useEffect(() => {
    searchRef.current = search;
  });

  const isDisabled = React.useCallback(
    (item: T) => (isItemDisabled ? isItemDisabled(item) : false),
    [isItemDisabled],
  );

  const firstEnabled = React.useCallback(
    (items: T[]): number => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item !== undefined && !isDisabled(item)) return i;
      }
      return -1;
    },
    [isDisabled],
  );

  const debounced = useDebouncedValue(query, debounceMs);

  React.useEffect(() => {
    const q = debounced.trim();
    // Pinned selections don't search in the background; sub-threshold queries
    // clear. Both cases mirror the two hand-rolled copies this replaces.
    if (value !== null || q.length < minChars) {
      setResults([]);
      setSearched(false);
      setActiveIndex(-1);
      return;
    }
    let cancelled = false;
    searchRef
      .current(q)
      .then((items) => {
        if (cancelled) return;
        setResults(items);
        setActiveIndex(firstEnabled(items));
        setSearched(true);
        setOpen(true);
      })
      .catch(() => {
        // Rejections are swallowed — the dropdown simply shows nothing.
        if (cancelled) return;
        setResults([]);
        setSearched(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, value, minChars, firstEnabled]);

  React.useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const reactId = React.useId();
  const listboxId = `${id ?? reactId}-listbox`;

  const showEmpty = searched && results.length === 0 && debounced.trim().length >= minChars;
  const showDropdown = value === null && open && (results.length > 0 || showEmpty);

  function pick(item: T) {
    if (isDisabled(item)) return;
    onSelect(item);
    setOpen(false);
    setResults([]);
    setSearched(false);
    setActiveIndex(-1);
  }

  function clear() {
    onSelect(null);
    setQuery("");
    setResults([]);
    setSearched(false);
    setActiveIndex(-1);
    setOpen(false);
    // Refocus so the user can immediately type a new search.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function moveActive(direction: 1 | -1) {
    if (results.length === 0) return;
    let next = activeIndex;
    for (let step = 0; step < results.length; step++) {
      next = (next + direction + results.length) % results.length;
      const candidate = results[next];
      if (candidate !== undefined && !isDisabled(candidate)) {
        setActiveIndex(next);
        return;
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (value !== null) return;
    switch (e.key) {
      case "ArrowDown":
        if (!showDropdown) return;
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        if (!showDropdown) return;
        e.preventDefault();
        moveActive(-1);
        break;
      case "Enter": {
        const active = showDropdown && activeIndex >= 0 ? results[activeIndex] : undefined;
        if (active !== undefined) {
          // preventDefault so the enclosing form doesn't submit on select.
          e.preventDefault();
          pick(active);
        }
        break;
      }
      case "Escape":
        if (showDropdown) {
          e.preventDefault();
          setOpen(false);
        }
        break;
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        id={id}
        type={inputType}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-invalid={ariaInvalid || undefined}
        value={value !== null ? itemToLabel(value) : query}
        placeholder={placeholder}
        disabled={disabled || value !== null}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Defer so a mousedown on a result still resolves before we close.
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          blurTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
      />
      {value !== null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={clear}
        >
          Change
        </Button>
      )}
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-sm border-2 border-border-strong bg-surface-raised shadow-soft-md"
        >
          {results.length > 0
            ? results.map((item, index) => {
                const itemDisabled = isDisabled(item);
                const active = index === activeIndex;
                return (
                  <div
                    key={itemToKey(item)}
                    role="option"
                    aria-selected={active}
                    aria-disabled={itemDisabled || undefined}
                    onMouseDown={(e) => {
                      // Beat the input blur so the selection resolves.
                      e.preventDefault();
                      pick(item);
                    }}
                    onMouseMove={() => {
                      if (!itemDisabled && index !== activeIndex) setActiveIndex(index);
                    }}
                    className={cn(
                      "w-full text-left",
                      itemDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    )}
                  >
                    {renderItem(item, active)}
                  </div>
                );
              })
            : showEmpty && (
                <div
                  role="option"
                  aria-disabled
                  className="px-3 py-2 text-sm text-muted-foreground/80"
                >
                  {emptyText}
                </div>
              )}
        </div>
      )}
    </div>
  );
}
