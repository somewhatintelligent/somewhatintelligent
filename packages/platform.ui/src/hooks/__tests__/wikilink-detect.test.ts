import { describe, expect, test } from "vite-plus/test";

import { detectWikilink, applyWikilinkInsertion } from "../use-wikilink-autocomplete";

describe("detectWikilink", () => {
  test("detects an open [[ query immediately before the caret", () => {
    const text = "see [[foo bar";
    const match = detectWikilink(text, text.length);
    expect(match).toEqual({ query: "foo bar", start: 4, end: text.length });
  });

  test("returns null when the wikilink is already closed", () => {
    const text = "see [[foo]] done";
    expect(detectWikilink(text, text.length)).toBeNull();
  });

  test("returns null when a newline separates [[ from the caret", () => {
    const text = "[[foo\nbar";
    expect(detectWikilink(text, text.length)).toBeNull();
  });

  test("returns null when there is no [[ before the caret", () => {
    expect(detectWikilink("plain text", 5)).toBeNull();
  });

  test("only considers text up to the caret, not after it", () => {
    const text = "[[foo]] and [[bar";
    // Caret sits right after the first "[[foo" — before it is closed.
    expect(detectWikilink(text, 5)).toEqual({ query: "foo", start: 0, end: 5 });
  });

  test("matches an empty query the instant [[ is typed", () => {
    expect(detectWikilink("x [[", 4)).toEqual({ query: "", start: 2, end: 4 });
  });
});

describe("applyWikilinkInsertion", () => {
  test("replaces the open match with a completed [[slug]] and returns the caret", () => {
    const text = "see [[foo bar baz";
    const match = detectWikilink(text, text.length)!;
    const result = applyWikilinkInsertion(text, match, { slug: "foo-note", title: "Foo Note" });
    expect(result.value).toBe("see [[foo-note]]");
    expect(result.caret).toBe(result.value.length);
  });

  test("preserves text after the caret", () => {
    const text = "a [[qu tail";
    const match = detectWikilink(text, 6)!; // caret after "[[qu"
    const result = applyWikilinkInsertion(text, match, { slug: "quux", title: "Quux" });
    expect(result.value).toBe("a [[quux]] tail");
    expect(result.caret).toBe("a [[quux]]".length);
  });
});
