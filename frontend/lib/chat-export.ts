import { sourceHref, type AnswerSource } from "@/lib/ai-answer";
import type { ChatEntry } from "@/lib/ai-chat";

/** The words the export is written with, in the reader's language. */
export type ChatExportLabels = {
  title: string;
  exportedAt: string;
  question: string;
  answer: string;
  sources: string;
  alsoRead: string;
  web: string;
  files: string;
  /** The heading over the files the person attached in the chat that an answer cites. */
  attached?: string;
  notFound: string;
  failed: string;
  stopped: string;
  basis: (basis: string) => string;
};

function sourceLine(source: AnswerSource, origin: string, numbered: boolean): string {
  const link = `${origin}${sourceHref(source)}`;
  const files = source.files?.length
    ? ` - ${source.files.map((file) => file.filename).join(", ")}`
    : "";
  const lead = numbered ? `[${source.n}]` : "-";
  return `${lead} [${source.title}](${link}) (${source.space_key})${files}`;
}

/**
 * A conversation with the assistant as Markdown: each question, the answer as it was shown, and
 * what it was read from - to keep, to look back at, or to share when an answer was wrong.
 */
export function chatToMarkdown(
  entries: ChatEntry[],
  labels: ChatExportLabels,
  {
    origin = "",
    now = new Date(),
  }: { origin?: string; now?: Date } = {},
): string {
  const lines = [
    `# ${labels.title}`,
    "",
    `_${labels.exportedAt} ${now.toLocaleString()}_`,
  ];
  let number = 0;
  for (const entry of entries) {
    if (entry.role === "user") {
      number += 1;
      lines.push("", "---", "", `## ${number}. ${labels.question}`, "", entry.content.trim());
      if (entry.files?.length) {
        lines.push("", `_${labels.files}: ${entry.files.map((file) => file.filename).join(", ")}_`);
      }
      continue;
    }
    const basis = entry.basis ? ` (${labels.basis(entry.basis)})` : "";
    lines.push("", `### ${labels.answer}${basis}`, "");
    if (entry.status === "error") {
      lines.push(`_${labels.failed}_`);
      continue;
    }
    if (entry.status === "cancelled" && !entry.content.trim()) {
      lines.push(`_${labels.stopped}_`);
      continue;
    }
    if (entry.found === false && !entry.content.trim()) {
      lines.push(`_${labels.notFound}${entry.reason ? ` (${entry.reason})` : ""}_`);
    } else {
      lines.push(entry.content.trim());
    }
    if (entry.sources?.length) {
      lines.push("", `**${labels.sources}**`, "");
      lines.push(...entry.sources.map((source) => sourceLine(source, origin, true)));
    }
    if (entry.webSources?.length) {
      lines.push("", `**${labels.web}**`, "");
      lines.push(
        ...entry.webSources.map((page) => `[w${page.n}] [${page.title}](${page.url})`),
      );
    }
    if (entry.fileSources?.length) {
      // Kept nowhere but in the person's own conversation: named, never linked.
      lines.push("", `**${labels.attached ?? "Attached files"}**`, "");
      lines.push(...entry.fileSources.map((file) => `[f${file.n}] ${file.filename}`));
    }
    if (entry.related?.length) {
      lines.push("", `**${labels.alsoRead}**`, "");
      lines.push(...entry.related.map((source) => sourceLine(source, origin, false)));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** A file name for the export: ``wikihub-chat-2026-10-21-1530.md``. */
export function exportFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `wikihub-chat-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.md`
  );
}

/** Hand the Markdown to the browser as a download. */
export function downloadMarkdown(markdown: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
