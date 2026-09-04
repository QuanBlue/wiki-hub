"use client";

import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

type AttachmentMetadata = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

function attachmentIds(content: string): string[] {
  return Array.from(
    new Set(
      Array.from(
        content.matchAll(/\/api\/v1\/attachments\/([a-f0-9-]{36})/gi),
        (match) => match[1],
      ),
    ),
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PageAttachmentsDialog({
  pageTitle,
  content,
  open,
  onOpenChange,
}: {
  pageTitle: string;
  content: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useMemo(() => attachmentIds(content), [content]);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const loading = open && loadedContent !== content;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      ids.map((id) => api.get<AttachmentMetadata>(`/api/v1/attachments/${id}`)),
    )
      .then((next) => {
        if (!cancelled) setAttachments(next);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadedContent(content);
      });
    return () => {
      cancelled = true;
    };
  }, [ids, open]);

  function openAttachment(id: string) {
    window.dispatchEvent(
      new CustomEvent("wikihub:open-attachment-modal", {
        detail: { attachmentId: id },
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Attachments"
        description={`Files attached to “${pageTitle}”.`}
        className="max-w-2xl overflow-hidden"
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="animate-spin" /> Loading attachments...
          </div>
        ) : attachments.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            No attachments are embedded in this page.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y max-h-[min(65vh,36rem)] overflow-y-auto rounded-md border">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <FileText className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{attachment.filename}</p>
                  <p className="text-muted-foreground text-xs">
                    {attachment.content_type} · {formatBytes(attachment.size_bytes)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openAttachment(attachment.id)}
                  aria-label={`Open ${attachment.filename}`}
                  title={`Open ${attachment.filename}`}
                >
                  <Eye />
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Download ${attachment.filename}`}
                  title={`Download ${attachment.filename}`}
                >
                  <a href={`/api/v1/attachments/${attachment.id}/content`} download>
                    <Download />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
