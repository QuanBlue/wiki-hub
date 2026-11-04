/**
 * Splits the issue description's markdown source into styled runs, so the
 * Write box can show **bold**, _italic_, `code`, headings and so on while
 * someone types, without leaving the text box.
 *
 * Two rules keep it usable as an overlay on a plain textarea:
 * - Lossless: joining every run's `text` gives back the input exactly. The
 *   markers (`**`, `_`, backticks...) stay in the text, only dimmed, so the
 *   overlay lines up with the caret character for character.
 * - Same metrics: tones only change weight, slant, colour and background,
 *   never size or spacing (the caller picks a monospace face).
 */
export type MarkdownTone =
  | "plain"
  | "marker"
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "heading"
  | "quote"
  | "list";

export interface MarkdownRun {
  text: string;
  tone: MarkdownTone;
}

// Underscores only count at word edges, so snake_case_names stay plain.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|(?<!\w)__[^_\n]+__(?!\w))|(\*[^*\s][^*\n]*\*|(?<!\w)_[^_\s][^_\n]*_(?!\w))|(\[[^\]\n]+\]\([^)\n]+\))/g;

function pushRun(runs: MarkdownRun[], text: string, tone: MarkdownTone) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.tone === tone) last.text += text;
  else runs.push({ text, tone });
}

/** Inline syntax within one line (or the rest of it after a line prefix). */
function inline(runs: MarkdownRun[], text: string, base: MarkdownTone) {
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    pushRun(runs, text.slice(cursor, start), base);
    const [whole, code, bold, italic, link] = match;
    if (code) {
      pushRun(runs, "`", "marker");
      pushRun(runs, whole.slice(1, -1), "code");
      pushRun(runs, "`", "marker");
    } else if (bold) {
      pushRun(runs, whole.slice(0, 2), "marker");
      pushRun(runs, whole.slice(2, -2), "bold");
      pushRun(runs, whole.slice(-2), "marker");
    } else if (italic) {
      pushRun(runs, whole.slice(0, 1), "marker");
      pushRun(runs, whole.slice(1, -1), "italic");
      pushRun(runs, whole.slice(-1), "marker");
    } else if (link) {
      pushRun(runs, whole, "link");
    }
    cursor = start + whole.length;
  }
  pushRun(runs, text.slice(cursor), base);
}

export function highlightMarkdown(source: string): MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const lines = source.split("\n");
  let inFence = false;

  lines.forEach((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : "";

    if (/^```/.test(line)) {
      // The fence lines themselves are markers; what is between them is code.
      pushRun(runs, line + newline, "marker");
      inFence = !inFence;
      return;
    }
    if (inFence) {
      pushRun(runs, line + newline, "code");
      return;
    }

    const heading = /^#{1,6} /.exec(line);
    if (heading) {
      pushRun(runs, heading[0], "marker");
      inline(runs, line.slice(heading[0].length), "heading");
    } else if (/^> ?/.test(line)) {
      const quote = /^> ?/.exec(line)![0];
      pushRun(runs, quote, "marker");
      inline(runs, line.slice(quote.length), "quote");
    } else {
      const list = /^(\s*)([-*+]|\d+\.) (\[[ xX]\] )?/.exec(line);
      if (list) {
        pushRun(runs, list[1], "plain");
        pushRun(runs, list[0].slice(list[1].length), "list");
        inline(runs, line.slice(list[0].length), "plain");
      } else {
        inline(runs, line, "plain");
      }
    }
    pushRun(runs, newline, "plain");
  });

  return runs;
}
