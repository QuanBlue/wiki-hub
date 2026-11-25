"use client";

import { CornerDownRight, Paperclip, X } from "lucide-react";

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
    <div className="border-border bg-surface mx-3 mb-2 rounded-2xl border px-1.5 py-1.5">
      <div className="flex h-6 items-center justify-between gap-2 pl-2">
        <p
          aria-live="polite"
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-wide"
        >
          <span className="truncate">
            {t(held ? "chat.queueHeld" : "chat.queued")}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{queue.length}</span>
        </p>
        {held ? (
          <button
            type="button"
            onClick={onResume}
            className="text-primary hover:bg-primary-subtle active:bg-primary-subtle focus-visible:ring-ring shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("chat.queueResume")}
          </button>
        ) : null}
      </div>
      <ol aria-label={t("chat.queueList")} className="max-h-32 overflow-y-auto">
        {queue.map((waiting) => (
          <li
            key={waiting.id}
            className="group hover:bg-surface-hover flex h-8 items-center gap-2 rounded-xl pr-1 pl-2 transition-colors duration-150"
          >
            <CornerDownRight
              className="text-muted-foreground/60 size-3.5 shrink-0"
              aria-hidden
            />
            <span
              className="text-foreground min-w-0 flex-1 truncate text-[13px]"
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
              // Quiet until the row is pointed at or tabbed to; always there on touch screens.
              className="text-muted-foreground hover:bg-surface-selected hover:text-foreground active:bg-surface-selected focus-visible:ring-ring inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-0 transition-[color,background-color,opacity] duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none [@media(hover:none)]:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
