import type { IssueAttachment } from "@/types/api";

/** Thumbnails of an issue's screenshots; each opens the full image. */
export function IssueScreenshots({
  attachments,
}: {
  attachments: IssueAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
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
  );
}
