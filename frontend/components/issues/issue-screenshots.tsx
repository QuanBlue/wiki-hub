import { Download, FileText } from "lucide-react";

import type { IssueAttachment } from "@/types/api";

function isImageAttachment(attachment: IssueAttachment): boolean {
  if (attachment.content_type) {
    return attachment.content_type.toLowerCase().startsWith("image/");
  }
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.filename);
}

function formatSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Thumbnails of an issue's screenshots and downloadable cards for file attachments. */
export function IssueScreenshots({
  attachments,
}: {
  attachments: IssueAttachment[];
}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((attachment) => !isImageAttachment(attachment));

  return (
    <div className="space-y-2">
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={attachment.content_url}
                target="_blank"
                rel="noreferrer"
                className="border-border hover:border-border-strong focus-visible:ring-ring block overflow-hidden rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.content_url}
                  alt={attachment.filename}
                  className="h-24 w-32 object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((attachment) => {
            const size = formatSize(attachment.size_bytes);
            return (
              <li key={attachment.id}>
                <a
                  href={attachment.content_url}
                  download={attachment.filename}
                  className="border-border bg-surface-sunken hover:bg-surface-hover hover:border-border-strong focus-visible:ring-ring flex max-w-64 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <FileText className="text-primary size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {attachment.filename}
                  </span>
                  {size ? (
                    <span className="text-muted-foreground shrink-0">{size}</span>
                  ) : null}
                  <Download className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
