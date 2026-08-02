import type { KeyBinding } from "@codemirror/view";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  insertCodeBlock,
  insertMathInline,
} from "./editor-commands";

export const markdownKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-s", run: toggleStrikethrough },
  { key: "Mod-e", run: toggleInlineCode },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Shift-k", run: insertCodeBlock },
  { key: "Mod-Shift-m", run: insertMathInline },
];
