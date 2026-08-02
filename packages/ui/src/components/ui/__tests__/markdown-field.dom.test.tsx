import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { MarkdownField } from "../markdown-field";
import type { WikilinkSuggestion } from "../../../hooks/use-wikilink-autocomplete";

function Harness({
  initial = "",
  wikilink,
}: {
  initial?: string;
  wikilink?: (q: string) => Promise<WikilinkSuggestion[]>;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <MarkdownField
      value={value}
      onValueChange={setValue}
      wikilink={wikilink}
      aria-label="Body"
      footer={({ chars, words }) => (
        <span>
          {chars} chars · {words} words
        </span>
      )}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Body") as HTMLTextAreaElement;
}

describe("MarkdownField — rendering", () => {
  test("renders the controlled value and a count-aware footer", () => {
    render(<Harness initial="hello world" />);
    expect(textarea()).toHaveValue("hello world");
    expect(screen.getByText("11 chars · 2 words")).toBeInTheDocument();
  });
});

describe("MarkdownField — Tab indent", () => {
  test("Tab inserts two spaces at the caret and prevents default", () => {
    render(<Harness initial="line" />);
    const el = textarea();
    el.selectionStart = 0;
    el.selectionEnd = 0;

    const notPrevented = fireEvent.keyDown(el, { key: "Tab" });
    expect(notPrevented).toBe(false); // handler called preventDefault
    expect(el).toHaveValue("  line");
  });

  test("Shift+Tab outdents leading spaces", () => {
    render(<Harness initial="    indented" />);
    const el = textarea();
    el.selectionStart = 6;
    el.selectionEnd = 6;

    fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    expect(el).toHaveValue("  indented");
  });
});

describe("MarkdownField — wikilink autocomplete", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const getSuggestions = vi.fn(async () => [
    { slug: "foo-note", title: "Foo Note" },
    { slug: "food", title: "Food" },
  ]);

  async function flush(ms = 150) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  test("opens a suggestion listbox for an unclosed [[ and inserts [[slug]]", async () => {
    render(<Harness wikilink={getSuggestions} />);
    const el = textarea();

    fireEvent.change(el, { target: { value: "see [[fo", selectionStart: 8 } });
    el.selectionStart = 8;
    el.selectionEnd = 8;
    fireEvent.keyUp(el, { key: "o" });
    await flush();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Foo Note"));
    expect(el).toHaveValue("see [[foo-note]]");
  });

  test("stays closed while an IME composition is active", async () => {
    render(<Harness wikilink={getSuggestions} />);
    const el = textarea();

    fireEvent.compositionStart(el);
    fireEvent.change(el, { target: { value: "see [[fo", selectionStart: 8 } });
    el.selectionStart = 8;
    el.selectionEnd = 8;
    fireEvent.keyUp(el, { key: "Process" });
    await flush();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Committing the composition lets the popover open.
    fireEvent.compositionEnd(el, { target: { value: "see [[fo" } });
    await flush();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
