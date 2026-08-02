import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SearchCombobox } from "../search-combobox";

// The component debounces its search through `useDebouncedValue` (setTimeout),
// so every suite drives the clock with fake timers. `@testing-library/user-event`
// is not a repo dependency, so keystrokes go through `fireEvent` (which
// auto-wraps in `act`); only timer advances need explicit `act`.
interface Item {
  id: string;
  name: string;
  taken?: boolean;
}

const ITEMS: Item[] = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Bravo", taken: true },
  { id: "3", name: "Charlie" },
];

/**
 * Controlled harness: `SearchCombobox` is a fully controlled component, so the
 * pin/unpin behaviour only shows up when the parent actually stores the picked
 * value. The harness threads `onSelect` back into local state (and out to the
 * `onSelect` spy) so a click pins and "Change" unpins the way a real caller
 * would wire it.
 */
function Harness({
  onSelect,
  search,
  minChars,
  debounceMs,
}: {
  onSelect: (item: Item | null) => void;
  search: (q: string) => Promise<Item[]>;
  minChars?: number;
  debounceMs?: number;
}) {
  const [value, setValue] = React.useState<Item | null>(null);
  return (
    <SearchCombobox<Item>
      value={value}
      onSelect={(item) => {
        onSelect(item);
        setValue(item);
      }}
      search={search}
      itemToKey={(i) => i.id}
      itemToLabel={(i) => i.name}
      renderItem={(i) => <span>{i.name}</span>}
      isItemDisabled={(i) => Boolean(i.taken)}
      placeholder="Search…"
      minChars={minChars}
      debounceMs={debounceMs}
    />
  );
}

/** Advance the debounce window and flush the search promise inside `act`. */
async function flushDebounce(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function typeInto(input: HTMLElement, values: string[]) {
  for (const v of values) fireEvent.change(input, { target: { value: v } });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchCombobox — debounced search", () => {
  test("coalesces rapid keystrokes into exactly one search after the debounce window", async () => {
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={vi.fn()} search={search} />);
    const input = screen.getByRole("combobox");

    typeInto(input, ["a", "al", "alp"]);
    // Nothing fires until the debounce window elapses.
    expect(search).not.toHaveBeenCalled();

    await flushDebounce();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("alp");
  });

  test("does not search while the query is below minChars", async () => {
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={vi.fn()} search={search} minChars={3} />);
    const input = screen.getByRole("combobox");

    typeInto(input, ["al"]); // 2 chars, minChars = 3
    await flushDebounce();
    expect(search).not.toHaveBeenCalled();

    typeInto(input, ["alp"]); // now at threshold
    await flushDebounce();
    expect(search).toHaveBeenCalledTimes(1);
  });

  test("renders each result through renderItem/itemToLabel", async () => {
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={vi.fn()} search={search} />);
    typeInto(screen.getByRole("combobox"), ["alp"]);
    await flushDebounce();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  test("shows emptyText when a completed search returns nothing", async () => {
    const search = vi.fn(async () => [] as Item[]);
    render(<Harness onSelect={vi.fn()} search={search} />);
    typeInto(screen.getByRole("combobox"), ["zzz"]);
    await flushDebounce();

    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });
});

describe("SearchCombobox — selection & pinning", () => {
  test("clicking a result calls onSelect with the item and pins it (input disabled + labelled)", async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={onSelect} search={search} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(input, ["alp"]);
    await flushDebounce();

    // onMouseDown (not click) is what the component wires, to beat input blur.
    fireEvent.mouseDown(screen.getByText("Alpha"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    // Pinned: input now shows the label, is disabled, and the dropdown is gone.
    expect(input).toBeDisabled();
    expect(input).toHaveValue("Alpha");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("clicking Change on a pinned value calls onSelect(null) and unpins", async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={onSelect} search={search} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(input, ["alp"]);
    await flushDebounce();
    fireEvent.mouseDown(screen.getByText("Alpha"));
    expect(input).toBeDisabled();

    // requestAnimationFrame is used to refocus after clear — flush it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSelect).toHaveBeenLastCalledWith(null);
    // Unpinned: input is editable again and empty.
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });
});

describe("SearchCombobox — keyboard navigation", () => {
  test("ArrowDown moves the active option, skipping a disabled item", async () => {
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={vi.fn()} search={search} />);
    const input = screen.getByRole("combobox");
    typeInto(input, ["alp"]);
    await flushDebounce();

    // First enabled option (Alpha) starts active; Bravo is disabled.
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Bravo (index 1) is skipped — active jumps straight to Charlie (index 2).
    const after = screen.getAllByRole("option");
    expect(after[1]).toHaveAttribute("aria-selected", "false");
    expect(after[2]).toHaveAttribute("aria-selected", "true");
  });

  test("Enter selects the active option and prevents default (no enclosing-form submit)", async () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const search = vi.fn(async () => ITEMS);
    render(
      <form onSubmit={onSubmit}>
        <Harness onSelect={onSelect} search={search} />
      </form>,
    );
    const input = screen.getByRole("combobox");
    typeInto(input, ["alp"]);
    await flushDebounce();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> Charlie

    // fireEvent returns false when the handler called preventDefault.
    const notPrevented = fireEvent.keyDown(input, { key: "Enter" });
    expect(notPrevented).toBe(false);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]); // Charlie
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Escape closes the dropdown without clearing the typed query", async () => {
    const search = vi.fn(async () => ITEMS);
    render(<Harness onSelect={vi.fn()} search={search} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(input, ["alp"]);
    await flushDebounce();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // The typed query survives — only the dropdown closed.
    expect(input).toHaveValue("alp");
  });
});
