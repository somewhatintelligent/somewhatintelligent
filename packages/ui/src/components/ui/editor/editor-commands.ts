import type { EditorView } from "@codemirror/view";

function wrapSelection(view: EditorView, before: string, after: string): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  const beforeCheck = view.state.sliceDoc(from - before.length, from);
  const afterCheck = view.state.sliceDoc(to, to + after.length);
  if (beforeCheck === before && afterCheck === after) {
    view.dispatch({
      changes: [
        { from: from - before.length, to: from, insert: "" },
        { from: to, to: to + after.length, insert: "" },
      ],
      selection: { anchor: from - before.length, head: to - before.length },
    });

    return true;
  }

  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: to + before.length },
  });

  return true;
}

function prefixLines(view: EditorView, prefix: string): boolean {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];
  let allPrefixed = true;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = view.state.doc.line(i);
    if (!line.text.startsWith(prefix)) {
      allPrefixed = false;
      break;
    }
  }

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = view.state.doc.line(i);
    if (allPrefixed) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  view.dispatch({ changes });

  return true;
}

export function toggleBold(view: EditorView): boolean {
  return wrapSelection(view, "**", "**");
}

export function toggleItalic(view: EditorView): boolean {
  return wrapSelection(view, "*", "*");
}

export function toggleStrikethrough(view: EditorView): boolean {
  return wrapSelection(view, "~~", "~~");
}

export function toggleInlineCode(view: EditorView): boolean {
  return wrapSelection(view, "`", "`");
}

export function insertCodeBlock(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const insert = `\n\`\`\`\n${selected}\n\`\`\`\n`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 4 }, // cursor on the language line
  });

  return true;
}

export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = selected || "link text";
  const insert = `[${text}](url)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + text.length + 3, head: from + text.length + 6 },
  });

  return true;
}

export function insertImage(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const alt = selected || "alt text";
  const insert = `![${alt}](url)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + alt.length + 4, head: from + alt.length + 7 },
  });

  return true;
}

export function insertHeading(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = "#".repeat(level) + " ";

  // Remove existing heading prefix if any
  const match = line.text.match(/^#{1,6}\s/);
  if (match) {
    view.dispatch({
      changes: { from: line.from, to: line.from + match[0].length, insert: prefix },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
    });
  }

  return true;
}

export function toggleBlockquote(view: EditorView): boolean {
  return prefixLines(view, "> ");
}

export function toggleUnorderedList(view: EditorView): boolean {
  return prefixLines(view, "- ");
}

export function toggleOrderedList(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];
  let allPrefixed = true;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = view.state.doc.line(i);
    if (!/^\d+\.\s/.test(line.text)) {
      allPrefixed = false;
      break;
    }
  }

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = view.state.doc.line(i);
    if (allPrefixed) {
      const match = line.text.match(/^\d+\.\s/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
      }
    } else {
      const num = i - startLine.number + 1;
      changes.push({ from: line.from, to: line.from, insert: `${num}. ` });
    }
  }

  view.dispatch({ changes });

  return true;
}

export function insertHorizontalRule(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  view.dispatch({
    changes: { from, to: from, insert: "\n---\n" },
    selection: { anchor: from + 5 },
  });

  return true;
}

export function insertMathInline(view: EditorView): boolean {
  return wrapSelection(view, "$", "$");
}

export function insertMathBlock(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const insert = `\n$$\n${selected}\n$$\n`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 4 },
  });

  return true;
}
