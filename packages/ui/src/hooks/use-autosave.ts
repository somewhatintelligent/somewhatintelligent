"use client";

import * as React from "react";

import { useDebouncedValue } from "@si/ui/hooks/use-debounced-value";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseAutosaveOptions<T> {
  /** The live, edited value. */
  value: T;
  /** Baseline the value is compared against; omit to track the last saved value internally. */
  savedValue?: T;
  /** Overrides equality — return true when `value` differs from the baseline. */
  isDirty?: (value: T, savedValue: T | undefined) => boolean;
  /** Quiet period before a save fires. Default 800ms. */
  delayMs?: number;
  /** Persist the value; `{ ok: false }` (or a rejection) puts the hook in "error". */
  onSave: (value: T) => Promise<{ ok: boolean }>;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Save the latest value immediately, skipping the debounce. */
  flush: () => void;
  /** Epoch ms of the last successful save, or null. */
  lastSavedAt: number | null;
}

/**
 * Debounced autosave with dirty-tracking and a save lifecycle. Coalesces rapid
 * edits into one trailing save, re-saves when edits land during a save in
 * flight, flushes any pending change on unmount, and retries on the next edit
 * after an error.
 */
export function useAutosave<T>({
  value,
  savedValue,
  isDirty,
  delayMs = 800,
  onSave,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = React.useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [saveTick, setSaveTick] = React.useState(0);

  const savedRef = React.useRef<T>(savedValue !== undefined ? savedValue : value);
  const latestRef = React.useRef<T>(value);
  const inFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  // Keep unstable inline callbacks in refs so effects don't re-fire per render.
  const onSaveRef = React.useRef(onSave);
  const isDirtyRef = React.useRef(isDirty);
  React.useEffect(() => {
    onSaveRef.current = onSave;
    isDirtyRef.current = isDirty;
  });

  latestRef.current = value;
  React.useEffect(() => {
    if (savedValue !== undefined) savedRef.current = savedValue;
  }, [savedValue]);

  const dirty = React.useCallback((candidate: T): boolean => {
    const fn = isDirtyRef.current;
    return fn ? fn(candidate, savedRef.current) : !Object.is(candidate, savedRef.current);
  }, []);

  const runSave = React.useCallback(
    (candidate: T) => {
      inFlightRef.current = true;
      setStatus("saving");
      onSaveRef
        .current(candidate)
        .then((res) => {
          inFlightRef.current = false;
          if (!mountedRef.current) return;
          if (!res.ok) {
            setStatus("error");
            return;
          }
          savedRef.current = candidate;
          setLastSavedAt(Date.now());
          if (dirty(latestRef.current)) {
            // Edits landed mid-flight — re-run the save effect for the latest value.
            setStatus("dirty");
            setSaveTick((t) => t + 1);
          } else {
            setStatus("saved");
          }
        })
        .catch(() => {
          inFlightRef.current = false;
          if (mountedRef.current) setStatus("error");
        });
    },
    [dirty],
  );

  const debounced = useDebouncedValue(value, delayMs);

  React.useEffect(() => {
    if (inFlightRef.current) return;
    if (!dirty(debounced)) return;
    runSave(debounced);
  }, [debounced, saveTick, dirty, runSave]);

  // Surface the dirty state as soon as an edit lands, ahead of the debounce.
  React.useEffect(() => {
    if (inFlightRef.current) return;
    if (dirty(value)) {
      setStatus((s) => (s === "saving" ? s : "dirty"));
    } else {
      // Value matches the baseline again (e.g. an undo) — drop back to a
      // settled state without clobbering an in-progress save.
      setStatus((s) => (s === "saving" ? s : lastSavedAt !== null ? "saved" : "idle"));
    }
  }, [value, dirty, lastSavedAt]);

  const flush = React.useCallback(() => {
    if (inFlightRef.current) return;
    if (dirty(latestRef.current)) runSave(latestRef.current);
  }, [dirty, runSave]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Best-effort save of any pending edit; no setState after unmount.
      if (!inFlightRef.current && dirty(latestRef.current)) {
        void onSaveRef.current(latestRef.current).catch(() => {});
      }
    };
  }, [dirty]);

  return { status, flush, lastSavedAt };
}
