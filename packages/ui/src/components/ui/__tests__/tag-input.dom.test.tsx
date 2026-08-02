import { describe, expect, test, vi } from "vite-plus/test";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { TagInput } from "../tag-input";

// `@testing-library/user-event` is not a repo dependency, so keystrokes go
// through `fireEvent`. A controlled harness threads `onValueChange` back into
// local state so add/remove behaviour shows up as a real caller would wire it.
function Harness({
  initial = [],
  suggestions,
  maxTags,
  onChange,
}: {
  initial?: string[];
  suggestions?: string[];
  maxTags?: number;
  onChange?: (v: string[]) => void;
}) {
  const [value, setValue] = React.useState<string[]>(initial);
  return (
    <TagInput
      value={value}
      onValueChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
      suggestions={suggestions}
      maxTags={maxTags}
      placeholder="Add tag…"
      aria-label="Tags"
    />
  );
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("TagInput — add & remove", () => {
  test("Enter adds the typed tag and clears the field", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    type(input, "alpha");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  test("a comma commits the tag", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    type(input, "beta");
    fireEvent.keyDown(input, { key: "," });
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  test("dedupes case-insensitively", () => {
    const onChange = vi.fn();
    render(<Harness initial={["Alpha"]} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    type(input, "ALPHA");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getAllByText(/alpha/i)).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  test("Backspace on an empty field removes the last tag", () => {
    render(<Harness initial={["one", "two"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(screen.queryByText("two")).not.toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  test("Backspace does not remove a tag while the field has text", () => {
    render(<Harness initial={["one"]} />);
    const input = screen.getByRole("combobox");
    type(input, "x");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  test("clicking a chip's X removes that tag", () => {
    render(<Harness initial={["keep", "drop"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove drop" }));
    expect(screen.queryByText("drop")).not.toBeInTheDocument();
    expect(screen.getByText("keep")).toBeInTheDocument();
  });

  test("maxTags blocks further additions and disables the input", () => {
    render(<Harness initial={["a"]} maxTags={1} />);
    const input = screen.getByRole("combobox");
    expect(input).toBeDisabled();
  });
});

describe("TagInput — suggestions", () => {
  test("filters suggestions as you type and adds the picked one", () => {
    render(<Harness suggestions={["apple", "apricot", "banana"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    type(input, "ap");

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["apple", "apricot"]);

    fireEvent.mouseDown(screen.getByText("apricot"));
    expect(screen.getByText("apricot")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  test("ArrowDown + Enter selects the active suggestion", () => {
    render(<Harness suggestions={["apple", "apricot"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    type(input, "ap");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> apple
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active -> apricot
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("apricot")).toBeInTheDocument();
  });

  test("already-selected tags are excluded from suggestions", () => {
    render(<Harness initial={["apple"]} suggestions={["apple", "apricot"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    type(input, "ap");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["apricot"]);
  });
});
