"use client";

import { Paperclip, X } from "lucide-react";

import type { QueuedQuestion } from "@/lib/ai-chat-store";
import { useTranslation } from "@/lib/i18n/context";

/**
 * The questions waiting their turn, above the box. ``held``: no reply is being written, so they
 * go only when the person says so.
 */
export function ChatQueue({
  queue,
  held,
  onRemove,
  onResume,
}: {
  queue: QueuedQuestion[];
  held: boolean;
  onRemove: (id: string) => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-border bg-surface-sunken mb-2 rounded-2xl border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 px-1.5">
        <p
          aria-live="polite"
          className="text-muted-foreground text-[11px] font-medium"
        >
          {t(held ? "chat.queueHeld" : "chat.queued", { count: queue.length })}
        </p>
        {held ? (
          <button
            type="button"
            onClick={onResume}
            className="text-primary hover:bg-primary-subtle active:bg-primary/20 focus-visible:ring-ring shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("chat.queueResume")}
          </button>
        ) : null}
      </div>
      <ol
        aria-label={t("chat.queueList")}
        className="mt-0.5 max-h-32 overflow-y-auto"
      >
        {queue.map((waiting, index) => (
          <li
            key={waiting.id}
            className="hover:bg-surface-hover flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-1.5 text-xs transition-colors duration-150"
          >
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {index + 1}.
            </span>
            <span
              className="text-foreground min-w-0 flex-1 truncate"
              title={waiting.content}
            >
              {waiting.content}
            </span>
            {waiting.files?.length ? (
              <span
                className="text-muted-foreground inline-flex shrink-0"
                title={waiting.files.map((file) => file.filename).join(", ")}
              >
                <Paperclip className="size-3" aria-hidden />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(waiting.id)}
              aria-label={t("chat.queueRemove", { text: waiting.content })}
              title={t("chat.queueRemove", { text: waiting.content })}
              className="text-muted-foreground hover:bg-surface-selected hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
