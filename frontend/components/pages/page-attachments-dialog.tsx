"use client";

import { Download, Eye, FileText, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { openChat } from "@/lib/ai-chat";
import { aiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";

/** Whether search and the assistant can use the words inside a file (see the backend's
 * ``AttachmentText``); absent for files that are not documents, such as images. */
type TextStatus =
  | "ok"
  | "waiting"
  | "empty"
  | "scanned"
  | "unsupported"
  | "too_large"
  | "failed";

type AttachmentMetadata = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  text_status?: TextStatus | null;
};

const STATUS_TONE: Record<TextStatus, BadgeProps["variant"]> = {
  ok: "success",
  waiting: "info",
  empty: "neutral",
  scanned: "warning",
  unsupported: "neutral",
  too_large: "warning",
  failed: "danger",
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
  const { t } = useTranslation();
  const ids = useMemo(() => attachmentIds(content), [content]);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  // "Ask about this file" needs the assistant, which does not exist while AI is off.
  const [canAsk, setCanAsk] = useState(false);
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
    void aiStatus().then((status) => {
      if (!cancelled) setCanAsk(Boolean(status?.enabled));
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

  function ask(attachment: AttachmentMetadata) {
    onOpenChange(false);
    openChat({ file: { id: attachment.id, filename: attachment.filename } });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("attachments.title")}
        description={t("attachments.description", { page: pageTitle })}
        className="max-w-2xl overflow-hidden"
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="animate-spin" /> {t("attachments.loading")}
          </div>
        ) : attachments.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            {t("attachments.empty")}
          </p>
        ) : (
          <ul className="border-border divide-border divide-y max-h-[min(65vh,36rem)] overflow-y-auto rounded-md border">
            {attachments.map((attachment) => {
              const status = attachment.text_status ?? null;
              return (
                <li
                  key={attachment.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
                >
                  <FileText className="text-muted-foreground size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{attachment.filename}</p>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span>
                        {attachment.content_type} · {formatBytes(attachment.size_bytes)}
                      </span>
                      {status ? (
                        <Badge
                          variant={STATUS_TONE[status] ?? "neutral"}
                          title={t(`attachments.text_${status}_hint`)}
                          className="text-[10px]"
                        >
                          {t(`attachments.text_${status}`)}
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canAsk && status === "ok" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => ask(attachment)}
                        aria-label={t("attachments.askAria", { file: attachment.filename })}
                      >
                        <Sparkles aria-hidden />
                        {t("attachments.ask")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openAttachment(attachment.id)}
                      aria-label={t("attachments.open", { file: attachment.filename })}
                      title={t("attachments.open", { file: attachment.filename })}
                    >
                      <Eye />
                    </Button>
                    <Button
                      asChild
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("attachments.download", { file: attachment.filename })}
                      title={t("attachments.download", { file: attachment.filename })}
                    >
                      <a href={`/api/v1/attachments/${attachment.id}/content`} download>
                        <Download />
                      </a>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
