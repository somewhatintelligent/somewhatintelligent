import { EditorView, drawSelection } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror theme mapped to the SI design tokens. Uses semantic CSS custom
 * properties so it adapts to light/dark automatically.
 */
const siTheme = EditorView.theme({
  "&": {
    fontSize: "0.875rem",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
    padding: "0.75rem 0",
    caretColor: "var(--color-primary)",
  },
  ".cm-scroller": {
    scrollbarWidth: "none",
  },
  ".cm-scroller::-webkit-scrollbar": {
    display: "none",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--color-primary)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, &.cm-focused ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 35%, transparent) !important",
  },
  "& .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-primary) 35%, transparent) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--color-background) 50%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface-sunken)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    paddingLeft: "0",
  },
  ".cm-gutters .cm-gutterElement": {
    paddingLeft: "4px",
    paddingRight: "6px",
    textAlign: "left",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-muted-foreground)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-surface-sunken)",
    border: "1px solid var(--color-border)",
    color: "var(--color-muted-foreground)",
    borderRadius: "2px",
    padding: "0 4px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface-raised)",
    border: "1px solid var(--color-border)",
    borderRadius: "2px",
  },
  ".cm-panels": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-placeholder": {
    color: "var(--color-muted-foreground)",
    fontStyle: "italic",
  },
});

const siHighlightStyle = HighlightStyle.define([
  // Headings — progressively larger
  { tag: tags.heading1, fontSize: "1.4em", fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.heading2, fontSize: "1.2em", fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.heading3, fontSize: "1.05em", fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.heading4, fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.heading5, fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.heading6, fontWeight: "600", color: "var(--color-muted-foreground)" },

  // Emphasis
  { tag: tags.strong, fontWeight: "600", color: "var(--color-foreground)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "var(--color-muted-foreground)",
  },

  // Code
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    color: "var(--color-primary)",
    backgroundColor: "var(--color-surface-sunken)",
    borderRadius: "2px",
  },

  // Links
  { tag: tags.link, color: "var(--color-primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--color-primary)" },

  // Quotes
  { tag: tags.quote, fontStyle: "italic", color: "var(--color-primary)" },

  // tags.list wraps entire list item content — force it back to default text color
  { tag: tags.list, color: "var(--color-foreground)" },

  // Meta / markers (the ** and * and # characters)
  { tag: tags.processingInstruction, color: "var(--color-muted-foreground)" },
  { tag: tags.meta, color: "var(--color-muted-foreground)" },

  // HTML tags in markdown
  { tag: tags.angleBracket, color: "var(--color-muted-foreground)" },
  { tag: tags.tagName, color: "var(--color-destructive)" },
  { tag: tags.attributeName, color: "var(--color-warning)" },
  { tag: tags.attributeValue, color: "var(--color-accent)" },

  // Content (keywords, atoms inside code blocks)
  { tag: tags.keyword, color: "var(--color-destructive)" },
  { tag: tags.atom, color: "var(--color-warning)" },
  { tag: tags.number, color: "var(--color-warning)" },
  { tag: tags.string, color: "var(--color-accent)" },
  { tag: tags.comment, color: "var(--color-muted-foreground)", fontStyle: "italic" },
  { tag: tags.variableName, color: "var(--color-foreground)" },
  { tag: tags.definition(tags.variableName), color: "var(--color-primary)" },
]);

export const editorTheme = [siTheme, syntaxHighlighting(siHighlightStyle), drawSelection()];
