/**
 * Formatting actions for the issue description box: what each toolbar button
 * (and Ctrl+B / Ctrl+I) does to the text and the selection. Pure, so it is
 * tested without a browser.
 */
export type MarkdownFormat =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "code"
  | "link"
  | "bullets"
  | "numbers"
  | "tasks";

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrap(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string,
): EditResult {
  const selected = value.slice(start, end);
  // Pressing the button again on an already-wrapped selection takes it off.
  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  return {
    value: value.slice(0, start) + open + selected + close + value.slice(end),
    selectionStart: start + open.length,
    selectionEnd: start + open.length + selected.length,
  };
}

const LINE_PREFIX: Record<
  "heading" | "quote" | "bullets" | "numbers" | "tasks",
  { has: RegExp; make: (index: number) => string }
> = {
  heading: { has: /^### /, make: () => "### " },
  quote: { has: /^> /, make: () => "> " },
  bullets: { has: /^[-*] (?!\[[ xX]\] )/, make: () => "- " },
  numbers: { has: /^\d+\. /, make: (index) => `${index + 1}. ` },
  tasks: { has: /^[-*] \[[ xX]\] /, make: () => "- [ ] " },
};

function prefixLines(
  value: string,
  start: number,
  end: number,
  kind: keyof typeof LINE_PREFIX,
): EditResult {
  // Work on whole lines, whatever part of them is selected.
  const blockStart = value.lastIndexOf("\n", start - 1) + 1;
  const newlineAfter = value.indexOf("\n", end);
  const blockEnd = newlineAfter === -1 ? value.length : newlineAfter;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  const { has, make } = LINE_PREFIX[kind];

  const allPrefixed = lines.every((line) => has.test(line));
  const next = lines.map((line, index) => {
    if (allPrefixed) return line.replace(/^(### |> |[-*] (\[[ xX]\] )?|\d+\. )/, "");
    // Swap one list style for another instead of stacking markers.
    const bare = line.replace(/^(### |> |[-*] (\[[ xX]\] )?|\d+\. )/, "");
    return make(index) + bare;
  });
  const replaced = next.join("\n");
  return {
    value: value.slice(0, blockStart) + replaced + value.slice(blockEnd),
    selectionStart: blockStart,
    selectionEnd: blockStart + replaced.length,
  };
}

export function applyMarkdownFormat(
  format: MarkdownFormat,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): EditResult {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  switch (format) {
    case "bold":
      return wrap(value, start, end, "**", "**");
    case "italic":
      return wrap(value, start, end, "_", "_");
    case "code": {
      const selected = value.slice(start, end);
      return selected.includes("\n")
        ? wrap(value, start, end, "```\n", "\n```")
        : wrap(value, start, end, "`", "`");
    }
    case "link": {
      const selected = value.slice(start, end);
      const label = selected || "text";
      const url = "https://";
      const text = `[${label}](${url})`;
      const urlStart = start + label.length + 3;
      return {
        value: value.slice(0, start) + text + value.slice(end),
        selectionStart: urlStart,
        selectionEnd: urlStart + url.length,
      };
    }
    default:
      return prefixLines(value, start, end, format);
  }
}
