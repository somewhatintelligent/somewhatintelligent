import { gutter, GutterMarker } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import type { LineNumberMode } from "./editor-store";

/**
 * A StateField that tracks the cursor's line number.
 * When this field changes, any gutter that depends on it re-renders.
 */
const cursorLineField = StateField.define<number>({
  create(state) {
    return state.doc.lineAt(state.selection.main.head).number;
  },
  update(_value, tr) {
    return tr.state.doc.lineAt(tr.state.selection.main.head).number;
  },
});

class LineNumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }
  toDOM(): Text {
    return document.createTextNode(this.text);
  }
}

function absoluteGutter() {
  return gutter({
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      return new LineNumberMarker(String(lineNo));
    },
    class: "cm-lineNumbers",
  });
}

function relativeGutter() {
  return [
    cursorLineField,
    gutter({
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        const cursorLine = view.state.field(cursorLineField);
        if (lineNo === cursorLine) return new LineNumberMarker(String(lineNo));
        return new LineNumberMarker(String(Math.abs(lineNo - cursorLine)));
      },
      lineMarkerChange(update) {
        // Re-render when cursor line changes
        return update.state.field(cursorLineField) !== update.startState.field(cursorLineField);
      },
      class: "cm-lineNumbers",
    }),
  ];
}

export function createLineNumbers(mode: LineNumberMode) {
  if (mode === "off") return [];
  if (mode === "relative") return relativeGutter();
  return absoluteGutter();
}
