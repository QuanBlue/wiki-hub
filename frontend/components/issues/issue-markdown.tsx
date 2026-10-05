import type { ReactNode } from "react";

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
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(_[^_\n]+_)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
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
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (match[3]) {
      const split = token.indexOf("](");
      nodes.push(
        <a
          key={key}
          href={token.slice(split + 2, -1)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline underline-offset-2"
        >
          {token.slice(1, split)}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const BLOCK_START = /^(```|#{1,3}\s|>\s?|[-*]\s|\d+\.\s)/;

export function IssueMarkdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
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
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence, if there is one
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
          )}
        >
          {inline(heading[2], `h${key}`)}
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
      blocks.push(
        <blockquote
          key={key++}
          className="border-border text-muted-foreground my-2 border-l-2 pl-3"
        >
          {quoted.map((text, n) => (
            <p key={n}>{inline(text, `q${key}-${n}`)}</p>
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
            <span>{inline(text, `t${i}`)}</span>
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
          <li key={i}>{inline(lines[i].replace(/^[-*]\s+/, ""), `u${i}`)}</li>,
        );
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc pl-6">
          {items}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={i}>{inline(lines[i].replace(/^\d+\.\s+/, ""), `o${i}`)}</li>,
        );
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal pl-6">
          {items}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    // A line that merely looks like a block start but did not match one above
    // (e.g. "#hashtag") still has to be consumed, or the loop would stall.
    if (paragraph.length === 0) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-2">
        {paragraph.map((text, n) => (
          <span key={n}>
            {n > 0 ? <br /> : null}
            {inline(text, `p${key}-${n}`)}
          </span>
        ))}
      </p>,
    );
  }

  return (
    <div className={cn("text-sm break-words", className)}>{blocks}</div>
  );
}
