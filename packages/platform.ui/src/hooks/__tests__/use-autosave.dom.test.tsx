import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { act, render } from "@testing-library/react";

import { useAutosave, type UseAutosaveResult } from "../use-autosave";

// The hook debounces through `useDebouncedValue` (setTimeout) and resolves saves
// through promises, so every suite drives fake timers and flushes microtasks
// inside `act`. A rerenderable host threads the edited `value` in as a prop.
function Host({
  value,
  onSave,
  delayMs,
  report,
}: {
  value: string;
  onSave: (v: string) => Promise<{ ok: boolean }>;
  delayMs?: number;
  report: (r: UseAutosaveResult) => void;
}) {
  const result = useAutosave({ value, onSave, delayMs });
  report(result);
  return <span data-testid="status">{result.status}</span>;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutosave — lifecycle", () => {
  test("coalesces rapid edits into a single trailing save", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    let latest!: UseAutosaveResult;
    const report = (r: UseAutosaveResult) => (latest = r);
    const { rerender } = render(<Host value="a" onSave={onSave} report={report} />);

    rerender(<Host value="ab" onSave={onSave} report={report} />);
    rerender(<Host value="abc" onSave={onSave} report={report} />);
    expect(onSave).not.toHaveBeenCalled();

    await advance(800);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("abc");
    expect(latest.status).toBe("saved");
    expect(latest.lastSavedAt).not.toBeNull();
  });

  test("re-saves when an edit lands while a save is in flight", async () => {
    let resolveFirst!: (v: { ok: boolean }) => void;
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementation(async () => ({ ok: true }));

    let latest!: UseAutosaveResult;
    const report = (r: UseAutosaveResult) => (latest = r);
    const { rerender } = render(<Host value="a" onSave={onSave} report={report} />);

    rerender(<Host value="ab" onSave={onSave} report={report} />);
    await advance(800);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("saving");

    // Edit arrives mid-flight, past the debounce window.
    rerender(<Host value="abcd" onSave={onSave} report={report} />);
    await advance(800);
    expect(onSave).toHaveBeenCalledTimes(1); // still blocked by the in-flight save

    await act(async () => {
      resolveFirst({ ok: true });
    });
    await advance(0);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("abcd");
    expect(latest.status).toBe("saved");
  });

  test("enters error state and retries on the next edit", async () => {
    const onSave = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });

    let latest!: UseAutosaveResult;
    const report = (r: UseAutosaveResult) => (latest = r);
    const { rerender } = render(<Host value="a" onSave={onSave} report={report} />);

    rerender(<Host value="ab" onSave={onSave} report={report} />);
    await advance(800);
    expect(latest.status).toBe("error");
    expect(latest.lastSavedAt).toBeNull();

    rerender(<Host value="abc" onSave={onSave} report={report} />);
    await advance(800);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(latest.status).toBe("saved");
  });

  test("flush() saves immediately without waiting for the debounce", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    let latest!: UseAutosaveResult;
    const report = (r: UseAutosaveResult) => (latest = r);
    const { rerender } = render(<Host value="a" onSave={onSave} report={report} />);
    rerender(<Host value="ab" onSave={onSave} report={report} />);

    await act(async () => {
      latest.flush();
    });
    await advance(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("ab");
  });

  test("flushes a pending edit on unmount", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const report = () => {};
    const { rerender, unmount } = render(<Host value="a" onSave={onSave} report={report} />);
    rerender(<Host value="ab" onSave={onSave} report={report} />);

    // Unmount before the debounce fires — the pending edit must still persist.
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("ab");
  });
});
