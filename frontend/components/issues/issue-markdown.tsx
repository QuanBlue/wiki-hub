import {
  CircleAlert,
  Info,
  Lightbulb,
  OctagonAlert,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { CodeBlock } from "@/components/issues/code-block";
import { cn } from "@/lib/utils";

/**
 * A small, safe Markdown renderer for issue descriptions.
 *
 * It builds React elements and never injects HTML, so whatever someone types
 * - including `<script>` or `<img onerror=...>` - is shown as plain text.
 * Supported: headings, **bold**, _italic_, `code`, fenced code, links (http/
 * https only), quotes, bullet / numbered / task lists. A line break inside a
 * paragraph stays a line break, as people expect when typing a report.
 */
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((?:https?:\/\/[^)\s]+|attachment:[0-9a-fA-F-]{36}|cite:[wf]?\d{1,2})\))|((?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))/g;

/** The same, plus a bare ``https://...`` address (group 5), for text a model wrote. */
const INLINE_AUTOLINK = new RegExp(
  INLINE.source +
    // An address with a <placeholder> in it (group 5) is not a real link,
    // then a plain address (group 6).
    "|(https?:\\/\\/[^\\s<>]*<[^\\s<>]+>[^\\s<>)\\]]*[^\\s<>)\\].,;:!?])" +
    "|(https?:\\/\\/[^\\s<>)\\]]*[^\\s<>)\\].,;:!?])",
  "g",
);

/** Undo the backslashes a model puts before punctuation (``\<ip\>``, ``\_``). */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\<>*_`[\]()#+.!|{}~-])/g, "$1");
}

/**
 * ``> [!TIP] text`` (also NOTE, IMPORTANT, WARNING, SUCCESS, DANGER) draws a coloured callout in
 * rich text: the mark a model writes to say "this matters", with an icon so it is seen.
 */
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|SUCCESS|DANGER)\]\s*(.*)$/i;
const CALLOUTS: Record<
  string,
  { icon: LucideIcon; box: string; label: string }
> = {
  NOTE: {
    icon: Info,
    box: "border-info/40 bg-info-bg [&_svg]:text-info",
    label: "Note",
  },
  TIP: {
    icon: Lightbulb,
    box: "border-success/40 bg-success-bg [&_svg]:text-success",
    label: "Tip",
  },
  IMPORTANT: {
    icon: CircleAlert,
    box: "border-primary/40 bg-primary-subtle [&_svg]:text-primary",
    label: "Important",
  },
  WARNING: {
    icon: OctagonAlert,
    box: "border-warning/50 bg-warning-bg [&_svg]:text-warning",
    label: "Warning",
  },
  SUCCESS: {
    icon: CircleCheck,
    box: "border-success/40 bg-success-bg [&_svg]:text-success",
    label: "Done",
  },
  DANGER: {
    icon: OctagonAlert,
    box: "border-danger/40 bg-danger-bg [&_svg]:text-danger",
    label: "Careful",
  },
};

type InlineOptions = {
  /** Richer emphasis for an assistant's answer: coloured bold, ``==highlight==``. */
  rich?: boolean;
  /** Internal: ``==...==`` was already looked for in this piece of text. */
  highlighted?: boolean;
  /** Usernames whose ``@name`` is highlighted. */
  mentions?: ReadonlySet<string>;
  /** Turn a bare ``https://...`` address into a link. */
  autolink?: boolean;
  /** Called for ``[name](attachment:<id>)``; without it such a link is plain text. */
  onOpenAttachment?: (attachmentId: string) => void;
  /** Called for ``[n](cite:n)``, an AI answer's mark for its n-th source; without it, plain ``[n]``. */
  onCite?: (n: number, web?: boolean, file?: boolean) => void;
};

const MENTION = /(@[A-Za-z0-9][A-Za-z0-9_.-]*)/g;

/** Wrap the ``@name`` tokens that name a known person; leave other text alone. */
function withMentions(
  text: string,
  keyPrefix: string,
  mentions: ReadonlySet<string>,
): ReactNode[] {
  return text.split(MENTION).map((part, index) => {
    const name = part.startsWith("@")
      ? part.slice(1).replace(/[.-]+$/, "")
      : "";
    if (!name || !mentions.has(name.toLowerCase())) return part;
    const trailing = part.slice(1 + name.length);
    return (
      <span key={`${keyPrefix}-m${index}`}>
        <span className="bg-primary-subtle text-primary rounded px-1 font-medium">
          @{name}
        </span>
        {trailing}
      </span>
    );
  });
}

function inline(
  text: string,
  keyPrefix: string,
  options: InlineOptions = {},
): ReactNode[] {
  const { mentions, autolink, onOpenAttachment, onCite, rich } = options;
  if (rich && !options.highlighted && /==|\*/.test(text)) {
    // ==the one thing to remember== is marked like a highlighter and *a term* is italic; either
    // may hold bold or code. (Single asterisks are only italics here: in an issue, a pattern
    // such as *.log must stay as typed.)
    const MARKED =
      /(==[^=\n]+==|(?<![*\w])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![*\w]))/;
    return text.split(MARKED).flatMap<ReactNode>((part, n) => {
      const inner = { ...options, highlighted: true };
      if (/^==[^=\n]+==$/.test(part)) {
        return [
          <mark
            key={`${keyPrefix}-hl${n}`}
            className="bg-warning-bg text-foreground rounded [box-decoration-break:clone] px-1 py-0.5 font-medium"
          >
            {inline(part.slice(2, -2), `${keyPrefix}-hl${n}`, inner)}
          </mark>,
        ];
      }
      if (
        /^\*[^*\s](?:[^*\n]*[^*\s])?\*$/.test(part) &&
        !part.startsWith("**")
      ) {
        return [
          <em key={`${keyPrefix}-it${n}`}>
            {inline(part.slice(1, -1), `${keyPrefix}-it${n}`, inner)}
          </em>,
        ];
      }
      return inline(part, `${keyPrefix}-pl${n}`, inner);
    });
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  const pushText = (chunk: string) => {
    if (mentions && mentions.size > 0 && chunk.includes("@")) {
      nodes.push(...withMentions(chunk, `${keyPrefix}-t${index++}`, mentions));
    } else {
      nodes.push(chunk);
    }
  };
  if (autolink) text = unescapeMarkdown(text);
  for (const match of text.matchAll(autolink ? INLINE_AUTOLINK : INLINE)) {
    const at = match.index ?? 0;
    if (at > last) pushText(text.slice(last, at));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      nodes.push(
        <code
          key={key}
          className="bg-inline-code-bg text-inline-code rounded px-1 py-0.5 font-mono text-xs"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      nodes.push(
        <strong
          key={key}
          className={rich ? "text-foreground font-semibold" : undefined}
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (match[3]) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      if (href.startsWith("cite:")) {
        const target = href.slice("cite:".length);
        const web = target.startsWith("w");
        const file = target.startsWith("f");
        const n = Number(web || file ? target.slice(1) : target);
        nodes.push(
          onCite ? (
            <button
              key={key}
              type="button"
              onClick={() => (file ? onCite(n, false, true) : onCite(n, web))}
              aria-label={`${label}`}
              className="bg-primary-subtle text-primary hover:bg-surface-selected focus-visible:ring-ring mx-0.5 inline-flex min-w-5 cursor-pointer items-center justify-center rounded px-1 align-baseline text-[11px] leading-5 font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              {label}
            </button>
          ) : (
            `[${label}]`
          ),
        );
      } else if (href.startsWith("attachment:")) {
        const attachmentId = href.slice("attachment:".length);
        nodes.push(
          onOpenAttachment ? (
            <button
              key={key}
              type="button"
              onClick={() => onOpenAttachment(attachmentId)}
              className="text-primary hover:text-primary-hover hover:bg-primary-subtle focus-visible:ring-ring cursor-pointer rounded px-0.5 font-medium underline underline-offset-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              {label}
            </button>
          ) : (
            label
          ),
        );
      } else {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>,
        );
      }
    } else if (match[5]) {
      // Something to type or copy, with a part to fill in: not clickable.
      nodes.push(
        <code
          key={key}
          className="bg-inline-code-bg text-inline-code rounded px-1 py-0.5 font-mono text-xs [overflow-wrap:anywhere]"
        >
          {token}
        </code>,
      );
    } else if (match[6]) {
      nodes.push(
        <a
          key={key}
          href={token}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary hover:text-primary-hover [overflow-wrap:anywhere] underline underline-offset-2"
        >
          {token}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) pushText(text.slice(last));
  return nodes;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** The cells of one ``| a | b |`` row. */
function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const BLOCK_START = /^(```|#{1,3}\s|>\s?|[-*]\s|\d+\.\s)/;

export function IssueMarkdown({
  source,
  className,
  mentions,
  autolink,
  onOpenAttachment,
  onCite,
  codeCard,
  rich,
}: {
  source: string;
  className?: string;
  /** Usernames whose ``@name`` should be highlighted (compared case-insensitively). */
  mentions?: readonly string[];
  /** Make a bare ``https://...`` address a link (for text written by the AI). */
  autolink?: boolean;
  /** Makes ``[name](attachment:<id>)`` a button that calls this with the id. */
  onOpenAttachment?: (attachmentId: string) => void;
  /** Makes ``[n](cite:n)`` a numbered mark that calls this with n. */
  onCite?: (n: number, web?: boolean, file?: boolean) => void;
  /** Draw fenced code as a card with its language and a copy button. */
  codeCard?: boolean;
  /**
   * An assistant's answer, made easier to take in: coloured bold for the key words,
   * ``==highlight==``, coloured callouts (``> [!TIP]``), coloured list markers and headings.
   */
  rich?: boolean;
}) {
  const mentionSet: ReadonlySet<string> = new Set(
    (mentions ?? []).map((name) => name.toLowerCase()),
  );
  const options: InlineOptions = {
    mentions: mentionSet,
    autolink,
    onOpenAttachment,
    onCite,
    rich,
  };
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  /** A pipe table starts here: a row of cells, then the ``---|---`` row under it. */
  const startsTable = (at: number) =>
    at + 1 < lines.length &&
    TABLE_ROW.test(lines[at]) &&
    TABLE_SEPARATOR.test(lines[at + 1]);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const language = line.trimStart().slice(3).trim().split(/\s+/)[0] ?? "";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence, if there is one
      if (codeCard) {
        blocks.push(
          <CodeBlock key={key++} code={code.join("\n")} language={language} />,
        );
        continue;
      }
      blocks.push(
        <pre
          key={key++}
          className="border-border bg-surface-sunken my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs leading-5"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(
        <Tag
          key={key++}
          className={cn(
            "mt-3 mb-1 font-semibold",
            level === 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm",
            rich && "border-border mt-4 border-b pb-1",
          )}
        >
          {inline(heading[2], `h${key}`, options)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      const callout = rich ? CALLOUT.exec(quoted[0]) : null;
      if (callout) {
        const kind = CALLOUTS[callout[1].toUpperCase()];
        const Icon = kind.icon;
        const body = [callout[2], ...quoted.slice(1)].filter((text) => text);
        blocks.push(
          <aside
            key={key++}
            role="note"
            aria-label={kind.label}
            className={cn(
              "my-2.5 flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
              kind.box,
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="text-foreground min-w-0 flex-1 space-y-1">
              {body.map((text, n) => (
                <p key={n}>{inline(text, `c${key}-${n}`, options)}</p>
              ))}
            </div>
          </aside>,
        );
        continue;
      }
      blocks.push(
        <blockquote
          key={key++}
          className={cn(
            "border-border text-muted-foreground my-2 border-l-2 pl-3",
            rich &&
              "border-border-strong bg-surface-sunken text-foreground/85 rounded-r-lg border-l-4 py-1.5 pr-3 italic",
          )}
        >
          {quoted.map((text, n) => (
            <p key={n}>{inline(text, `q${key}-${n}`, options)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const done = /^[-*]\s+\[[xX]\]/.test(lines[i]);
        const text = lines[i].replace(/^[-*]\s+\[[ xX]\]\s+/, "");
        items.push(
          <li key={i} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={done}
              readOnly
              disabled
              className="accent-primary mt-1"
              aria-label={text}
            />
            <span>{inline(text, `t${i}`, options)}</span>
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-2 space-y-1">
          {items}
        </ul>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(
          <li key={i}>
            {inline(lines[i].replace(/^[-*]\s+/, ""), `u${i}`, options)}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ul
          key={key++}
          className={cn(
            "my-2 list-disc pl-6",
            rich && "marker:text-primary space-y-1",
          )}
        >
          {items}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={i}>
            {inline(lines[i].replace(/^\d+\.\s+/, ""), `o${i}`, options)}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ol
          key={key++}
          className={cn(
            "my-2 list-decimal pl-6",
            rich && "marker:text-primary space-y-1 marker:font-semibold",
          )}
        >
          {items}
        </ol>,
      );
      continue;
    }

    if (startsTable(i)) {
      const head = tableCells(lines[i]);
      i += 2; // the header row and the separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      const at = key++;
      blocks.push(
        <div
          key={at}
          className="border-border my-2 overflow-x-auto rounded-lg border"
        >
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-xs">
                {head.map((cell, column) => (
                  <th key={column} className="px-3 py-2 font-semibold">
                    {inline(cell, `th${at}-${column}`, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr
                  key={r}
                  className={cn(
                    "border-border border-b align-top last:border-b-0",
                    rich && "hover:bg-surface-hover even:bg-surface-sunken/40",
                  )}
                >
                  {head.map((_, column) => (
                    <td
                      key={column}
                      className={cn(
                        "px-3 py-2 [overflow-wrap:break-word]",
                        rich && column === 0 && "font-medium",
                      )}
                    >
                      {inline(
                        row[column] ?? "",
                        `td${at}-${r}-${column}`,
                        options,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // The first line is always taken, so a line that merely starts like a block cannot stall.
    const paragraph: string[] = [lines[i]];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BLOCK_START.test(lines[i]) &&
      !startsTable(i)
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-2">
        {paragraph.map((text, n) => (
          <span key={n}>
            {n > 0 ? <br /> : null}
            {inline(text, `p${key}-${n}`, options)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className={cn("text-sm break-words", className)}>{blocks}</div>;
}
