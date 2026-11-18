"use client";

import {
  Check,
  Clock3,
  Loader2,
  Lock,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n/context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { PublicUser, User } from "@/types/api";

const RECENT_STATUSES_KEY = "wikihub:recent-statuses";

export const EMOJI_CATEGORIES = [
  {
    key: "faces",
    nameKey: "profile.statusEmojiFaces",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😋", "😜", "🤪", "🤫", "🤔", "🫡", "😴",
      "🥳", "😎", "🤓", "🤠", "🥺", "😳", "🤯", "🥱", "🤤", "😬", "😮‍💨",
    ],
  },
  {
    key: "work",
    nameKey: "profile.statusEmojiWork",
    emojis: [
      "💻", "🖥️", "📱", "🎯", "🚀", "💡", "📝", "📊", "📈", "📅", "🔕", "🔔",
      "☕", "⚡", "🛠️", "📚", "💼", "🔬", "🎧", "📋", "🖋️", "⚙️", "🔍",
    ],
  },
  {
    key: "activities",
    nameKey: "profile.statusEmojiActivities",
    emojis: [
      "🏖️", "✈️", "🚗", "🚴", "🏃", "🧘", "🍕", "🍔", "🍻", "🎮", "🎨",
      "🎵", "🏠", "🤒", "🩺", "🛒", "🍿", "🧗", "⚽", "🏕️", "🏊", "🎉",
    ],
  },
  {
    key: "symbols",
    nameKey: "profile.statusEmojiSymbols",
    emojis: [
      "🟢", "🟡", "🔴", "⚪", "💬", "⭐", "🔥", "✨", "👍", "🤝", "🙌", "❤️",
      "⏰", "💤", "⏳", "🚫", "💯", "❗", "❓", "📌", "🎈",
    ],
  },
] as const;

export const STATUS_PRESETS = [
  { emoji: "🟢", textKey: "profile.statusPresetFree", defaultText: "Free to chat" },
  { emoji: "⏰", textKey: "profile.statusPresetSlow", defaultText: "Slow to respond" },
  { emoji: "🥳", textKey: "profile.statusPresetFriends", defaultText: "Hanging with friends" },
  { emoji: "✈️", textKey: "profile.statusPresetTravelling", defaultText: "Travelling" },
  { emoji: "🔥", textKey: "profile.statusPresetExcited", defaultText: "Excited!" },
] as const;

export type DurationOption = "1h" | "4h" | "24h" | "7d" | "never";

export const DURATION_MS: Record<Exclude<DurationOption, "never">, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export interface StatusBearingUser {
  status_emoji?: string | null;
  status_text?: string | null;
  status_expires_at?: string | null;
}

export function isUserStatusActive(user?: StatusBearingUser | null): boolean {
  if (!user) return false;
  const emoji = (user.status_emoji ?? "").trim();
  const text = (user.status_text ?? "").trim();
  if (!emoji && !text) return false;
  if (!user.status_expires_at) return true;
  const expiresAt = new Date(user.status_expires_at).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt > Date.now();
}

/**
 * Legacy inline badge kept for areas such as search/mentions and user menu.
 */
export function UserStatusBadge({
  user,
  onClick,
  className,
}: {
  user?: StatusBearingUser | PublicUser | User | null;
  onClick?: () => void;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  if (!isUserStatusActive(user)) return null;
  const emoji = (user?.status_emoji ?? "").trim();
  const text = (user?.status_text ?? "").trim();
  const title = user?.status_expires_at
    ? t("profile.statusExpiresTooltip", {
        time: new Date(user.status_expires_at).toLocaleString(locale),
      })
    : undefined;

  const inner = (
    <>
      {emoji ? (
        <span aria-hidden className="shrink-0 text-sm leading-none">
          {emoji}
        </span>
      ) : null}
      {text ? <span className="truncate">{text}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          "border-border bg-surface-sunken text-foreground hover:bg-surface-hover focus-visible:ring-ring inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        "border-border bg-surface-sunken text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        className,
      )}
    >
      {inner}
    </span>
  );
}

/**
 * WhatsApp-style floating thought bubble displayed above the avatar.
 * - When unset & owner: shows a dimmed bubble inviting them to set a status.
 * - When unset & non-owner: renders null (invisible to visitors).
 * - When set: shows a solid thought bubble with emoji + text.
 */
export function UserStatusBubble({
  user,
  isOwner = false,
  onClick,
  className,
}: {
  user?: StatusBearingUser | PublicUser | User | null;
  isOwner?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const active = isUserStatusActive(user);

  // If not set and not owner, don't show anything to visitors
  if (!active && !isOwner) {
    return null;
  }

  const emoji = (user?.status_emoji ?? "").trim();
  const text = (user?.status_text ?? "").trim();
  const title = user?.status_expires_at
    ? t("profile.statusExpiresTooltip", {
        time: new Date(user.status_expires_at).toLocaleString(locale),
      })
    : undefined;

  const bubbleBody = (
    <div className="relative inline-flex flex-col select-none">
      <div
        className={cn(
          "inline-flex max-w-[200px] sm:max-w-[250px] items-center gap-1.5 rounded-full px-3.5 py-1 text-xs sm:text-[13px] font-medium leading-snug border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-zinc-800 shadow-[0_2px_10px_rgba(0,0,0,0.12)] transition-all duration-150",
          active
            ? "text-slate-900 dark:text-slate-100"
            : "text-slate-600 dark:text-slate-300 opacity-80 group-hover:opacity-100",
        )}
      >
        {active ? (
          <>
            {emoji ? (
              <span className="shrink-0 text-sm leading-none" aria-hidden>
                {emoji}
              </span>
            ) : null}
            {text ? <span className="truncate">{text}</span> : null}
          </>
        ) : (
          <span className="truncate font-medium">{t("profile.statusWhatsHappening")}</span>
        )}
      </div>

      {/* Thought bubble circular connector dot at bottom-left like WhatsApp */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute -bottom-2.5 left-6 -translate-x-1/2 size-2.5 rounded-full border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-zinc-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-opacity duration-150 pointer-events-none",
          active ? "" : "opacity-80 group-hover:opacity-100",
        )}
      />
    </div>
  );

  if (isOwner && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? (active ? t("profile.updateStatus") : t("profile.setStatus"))}
        aria-label={active ? t("profile.updateStatus") : t("profile.setStatus")}
        className={cn(
          "group relative inline-flex flex-col cursor-pointer transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full select-none",
          className,
        )}
      >
        {bubbleBody}
      </button>
    );
  }

  return (
    <div
      title={title}
      className={cn("relative inline-flex flex-col select-none", className)}
    >
      {bubbleBody}
    </div>
  );
}

function calculateExpirationPreview(
  duration: DurationOption,
  locale: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (duration === "never") {
    return t("profile.statusNeverExpires");
  }
  const target = new Date(Date.now() + DURATION_MS[duration]);
  const weekday = target.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long",
  });
  const time = target.toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return t("profile.statusUntil", { weekday, time });
}

export function UserStatusDialog({
  open,
  onOpenChange,
  user,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StatusBearingUser;
  onUpdated?: (updated: User) => void;
}) {
  const router = useRouter();
  const { t, locale, apiErrorText } = useTranslation();
  const active = isUserStatusActive(user);
  const [emoji, setEmoji] = useState(active ? (user.status_emoji ?? "") : "💬");
  const [text, setText] = useState(active ? (user.status_text ?? "") : "");
  const [duration, setDuration] = useState<DurationOption>("24h");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("faces");
  const [recentStatuses, setRecentStatuses] = useState<Array<{ emoji: string; text: string }>>([]);
  const [pending, setPending] = useState(false);

  // Load recents from localStorage when opened
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(RECENT_STATUSES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentStatuses(parsed.slice(0, 3));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const isNowActive = isUserStatusActive(user);
    setEmoji(isNowActive ? (user.status_emoji ?? "") : "💬");
    setText(isNowActive ? (user.status_text ?? "") : "");
    setDuration(isNowActive && !user.status_expires_at ? "never" : "24h");
  }, [open, user]);

  const expirationPreview = useMemo(() => {
    return calculateExpirationPreview(duration, locale, t);
  }, [duration, locale, t]);

  function persistRecent(savedEmoji: string, savedText: string) {
    if (!savedText.trim()) return;
    try {
      const updated = [
        { emoji: savedEmoji || "💬", text: savedText.trim() },
        ...recentStatuses.filter(
          (item) => !(item.text.trim() === savedText.trim() && item.emoji === savedEmoji),
        ),
      ].slice(0, 3);
      setRecentStatuses(updated);
      localStorage.setItem(RECENT_STATUSES_KEY, JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmoji = emoji.trim();
    const cleanText = text.trim();
    if (!cleanEmoji && !cleanText) {
      await clear();
      return;
    }
    setPending(true);
    try {
      const expiresAt =
        duration === "never"
          ? null
          : new Date(Date.now() + DURATION_MS[duration]).toISOString();
      const updated = await api.patch<User>("/api/v1/users/me", {
        status_emoji: cleanEmoji,
        status_text: cleanText,
        status_expires_at: expiresAt,
      });
      persistRecent(cleanEmoji, cleanText);
      toast.success?.(t("profile.statusSaved"));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("wikihub:user-status-changed", {
            detail: {
              username: updated.username,
              status_emoji: updated.status_emoji,
              status_text: updated.status_text,
              status_expires_at: updated.status_expires_at,
            },
          }),
        );
      }
      onUpdated?.(updated);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error?.(apiErrorText(error, "profile.statusSaveError"));
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    setPending(true);
    try {
      const updated = await api.patch<User>("/api/v1/users/me", {
        clear_status: true,
      });
      toast.success?.(t("profile.statusCleared"));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("wikihub:user-status-changed", {
            detail: {
              username: updated.username,
              status_emoji: null,
              status_text: null,
              status_expires_at: null,
            },
          }),
        );
      }
      onUpdated?.(updated);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error?.(apiErrorText(error, "profile.statusSaveError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-md p-5"
        title={t("profile.statusAbout")}
      >
        <form onSubmit={(e) => void save(e)} className="space-y-4 pt-1">
          {/* Main Input Row: Emoji Button + Text Input */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {/* Emoji Picker Popover */}
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={t("profile.statusChooseEmoji")}
                    title={t("profile.statusChooseEmoji")}
                    className={cn(
                      "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-xl transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      emoji ? "text-foreground" : "text-emerald-500",
                    )}
                  >
                    {emoji ? (
                      <span className="leading-none">{emoji}</span>
                    ) : (
                      <Smile className="size-5 text-emerald-500" aria-hidden />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3">
                  <div className="space-y-2.5">
                    {/* Category tabs */}
                    <div className="flex flex-wrap gap-1 border-b border-border pb-2">
                      {EMOJI_CATEGORIES.map((cat) => (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => setActiveCategory(cat.key)}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                            activeCategory === cat.key
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                          )}
                        >
                          {t(cat.nameKey)}
                        </button>
                      ))}
                    </div>

                    {/* Emoji grid for active category */}
                    <div className="grid grid-cols-7 gap-1 max-h-48 overflow-y-auto pr-1">
                      {EMOJI_CATEGORIES.find((cat) => cat.key === activeCategory)?.emojis.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setEmoji(item);
                            setEmojiPickerOpen(false);
                          }}
                          className={cn(
                            "flex size-9 items-center justify-center rounded-md text-lg transition-transform hover:scale-125 hover:bg-surface-hover cursor-pointer",
                            emoji === item ? "bg-primary-subtle ring-1 ring-primary" : "",
                          )}
                        >
                          {item}
                        </button>
                      ))}
                    </div>

                    {/* Custom emoji manual text input */}
                    <div className="pt-1 border-t border-border flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground shrink-0">Custom:</span>
                      <Input
                        value={emoji}
                        onChange={(e) => setEmoji(e.target.value)}
                        placeholder="Type any emoji"
                        maxLength={16}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Text Input with X Clear button */}
              <div className="relative flex-1">
                <Input
                  id="user-status-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={140}
                  disabled={pending}
                  placeholder={active ? t("profile.statusShareAThought") : t("profile.statusWhatsHappening")}
                  className={cn(
                    "pr-8 h-10 text-sm",
                    text ? "pr-8" : "",
                  )}
                />
                {text ? (
                  <button
                    type="button"
                    onClick={() => setText("")}
                    disabled={pending}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer rounded-full transition-colors"
                    aria-label="Clear input"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Character counter */}
            <div className="text-right text-[11px] text-muted-foreground pr-1">
              {text.length}/140
            </div>
          </div>

          {/* Visibility indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Lock className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
            <span>{t("profile.statusVisibleWorkspace")}</span>
          </div>

          {/* Duration selector & dynamic expiration preview */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2.5">
              <Clock3 className="size-4 text-muted-foreground shrink-0" aria-hidden />
              <div className="flex-1">
                <Select
                  value={duration}
                  onValueChange={(val) => setDuration(val as DurationOption)}
                  disabled={pending}
                >
                  <SelectTrigger id="user-status-duration" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">{t("profile.statusDuration1h")}</SelectItem>
                    <SelectItem value="4h">{t("profile.statusDuration4h")}</SelectItem>
                    <SelectItem value="24h">{t("profile.statusDuration24h")}</SelectItem>
                    <SelectItem value="7d">{t("profile.statusDuration7d")}</SelectItem>
                    <SelectItem value="never">{t("profile.statusDurationNever")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground pl-7">{expirationPreview}</p>
          </div>

          {/* Presets List */}
          <div className="border-t border-border pt-2 space-y-1">
            {STATUS_PRESETS.map((preset) => {
              const label = t(preset.textKey) || preset.defaultText;
              return (
                <button
                  key={preset.textKey}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setEmoji(preset.emoji);
                    setText(label);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover cursor-pointer"
                >
                  <span className="text-base shrink-0 leading-none">{preset.emoji}</span>
                  <span className="font-normal text-foreground">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Recents list if available */}
          {recentStatuses.length > 0 ? (
            <div className="border-t border-border pt-2 space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground px-2.5 pb-0.5">
                {t("profile.statusRecentHeading")}
              </p>
              {recentStatuses.map((item, idx) => (
                <button
                  key={`${item.emoji}-${item.text}-${idx}`}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setEmoji(item.emoji);
                    setText(item.text);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover cursor-pointer"
                >
                  <span className="text-base shrink-0 leading-none">{item.emoji}</span>
                  <span className="truncate text-foreground">{item.text}</span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Dialog Footer with Delete button (when active) and Save button */}
          <DialogFooter className="flex items-center justify-between gap-2 border-t border-border pt-3">
            {active ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => void clear()}
                title={t("profile.statusClearConfirm")}
                aria-label={t("profile.statusClearConfirm")}
                className="text-muted-foreground hover:text-danger hover:bg-danger/10 cursor-pointer"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {t("profile.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pending || (!emoji.trim() && !text.trim())}
                size="icon"
                className="size-9 rounded-full"
                title={t("profile.statusSave")}
                aria-label={t("profile.statusSave")}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
