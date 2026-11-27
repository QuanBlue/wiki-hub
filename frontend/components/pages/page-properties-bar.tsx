"use client";

import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  Check,
  Clock3,
  FilePenLine,
  Info,
  Pencil,
  Plus,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { api, describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  PageCustomProperty,
  PageProperties,
  PageStatus,
  SpaceMember,
  WikiPage,
} from "@/types/api";

export const PAGE_STATUS_OPTIONS: Array<{
  value: PageStatus;
  labelEn: string;
  labelVi: string;
  badgeClass: string;
  dotClass: string;
  icon: LucideIcon;
}> = [
  {
    value: "draft",
    labelEn: "Draft",
    labelVi: "Nháp",
    badgeClass: "bg-surface-sunken text-muted-foreground border-border",
    dotClass: "bg-muted-foreground/60",
    icon: FilePenLine,
  },
  {
    value: "in_progress",
    labelEn: "In Progress",
    labelVi: "Đang cập nhật",
    badgeClass: "bg-info/10 text-info border-info/25",
    dotClass: "bg-info",
    icon: Clock3,
  },
  {
    value: "verified",
    labelEn: "Verified",
    labelVi: "Chính thức",
    badgeClass: "bg-success/10 text-success border-success/25",
    dotClass: "bg-success",
    icon: BadgeCheck,
  },
  {
    value: "outdated",
    labelEn: "Outdated",
    labelVi: "Lỗi thời",
    badgeClass: "bg-warning/10 text-warning border-warning/25",
    dotClass: "bg-warning",
    icon: AlertTriangle,
  },
  {
    value: "archived",
    labelEn: "Archived",
    labelVi: "Lưu trữ",
    badgeClass: "bg-danger/10 text-danger border-danger/25",
    dotClass: "bg-danger",
    icon: Archive,
  },
];

export function getPageStatusMeta(status?: PageStatus | null) {
  if (!status) return null;
  return PAGE_STATUS_OPTIONS.find((item) => item.value === status) ?? null;
}

export function hasAnyPageProperties(props?: PageProperties | null): boolean {
  if (!props) return false;
  return Boolean(
    props.status ||
      props.owner_id ||
      props.owner ||
      (props.custom && props.custom.length > 0),
  );
}

export function PageStatusPill({
  status,
  locale,
  className,
}: {
  status: PageStatus;
  locale: string;
  className?: string;
}) {
  const meta = getPageStatusMeta(status);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight",
        meta.badgeClass,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {locale === "vi" ? meta.labelVi : meta.labelEn}
    </span>
  );
}

/**
 * Compact header Info button + Popover for Page Properties.
 * - Keeps the page header clean and reading-first (no bulky horizontal bar).
 * - Displays structured metadata as a clean key-value table (distinct from labels).
 * - Shows a green verified tick when status === "verified".
 */
export function PagePropertiesInfoButton({
  spaceKey,
  page,
  members,
  canEdit,
  onUpdated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  align = "start",
}: {
  spaceKey: string;
  page: WikiPage;
  members: SpaceMember[];
  canEdit: boolean;
  onUpdated?: (updated: WikiPage) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const [propsState, setPropsState] = useState<PageProperties>(
    page.properties ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const hasProps = hasAnyPageProperties(propsState);
  const [editing, setEditing] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const [draftStatus, setDraftStatus] = useState<PageStatus | "">(
    page.properties?.status ?? "",
  );
  const [draftOwnerId, setDraftOwnerId] = useState<string>(
    page.properties?.owner_id ?? "",
  );
  const [draftCustom, setDraftCustom] = useState<PageCustomProperty[]>(
    page.properties?.custom ?? [],
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    const next = page.properties ?? {};
    setPropsState(next);
    setDraftStatus(next.status ?? "");
    setDraftOwnerId(next.owner_id ?? "");
    setDraftCustom(next.custom ?? []);
  }, [page.id, page.properties]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (!hasProps && !canEdit) {
    return null;
  }

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function handleHoverEnter() {
    clearCloseTimer();
    if (!hasProps) return;
    if (!open) {
      setEditing(false);
      setOpen(true);
    }
  }

  function handleHoverLeave() {
    if (editing || pinnedOpen) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 180);
  }

  function handleOpenChange(next: boolean) {
    clearCloseTimer();
    if (next) {
      setDraftStatus(propsState.status ?? "");
      setDraftOwnerId(propsState.owner_id ?? "");
      setDraftCustom(propsState.custom ?? []);
      setNewKey("");
      setNewValue("");
      setEditing(!hasProps && canEdit);
      setPinnedOpen(true);
    } else {
      setEditing(false);
      setPinnedOpen(false);
    }
    setOpen(next);
  }

  async function saveProperties(nextPayload: PageProperties) {
    setSaving(true);
    try {
      const updated = await api.patch<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}/properties`,
        {
          status: nextPayload.status ?? null,
          owner_id: nextPayload.owner_id ?? null,
          custom: (nextPayload.custom ?? []).filter(
            (item) => item.key.trim().length > 0,
          ),
        },
      );
      setPropsState(updated.properties ?? {});
      onUpdated?.(updated);
      setEditing(false);
      toast.success(
        isVi ? "Đã cập nhật thuộc tính trang" : "Page properties updated",
      );
    } catch (error) {
      toast.error(
        describeApiError(
          error,
          isVi
            ? "Không thể cập nhật thuộc tính trang"
            : "Failed to update page properties",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  function handleAddCustomField() {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    setDraftCustom((prev) => [...prev, { key: k, value: v }]);
    setNewKey("");
    setNewValue("");
  }

  function handleSave() {
    const pendingCustom = [...draftCustom];
    if (newKey.trim()) {
      pendingCustom.push({ key: newKey.trim(), value: newValue.trim() });
      setNewKey("");
      setNewValue("");
    }
    void saveProperties({
      status: draftStatus || null,
      owner_id: draftOwnerId || null,
      custom: pendingCustom,
    });
  }

  const ownerInfo =
    propsState.owner ??
    (propsState.owner_id
      ? (() => {
          const m = members.find((item) => item.user_id === propsState.owner_id);
          return m
            ? {
                id: m.user_id,
                username: m.username,
                full_name: m.full_name,
                avatar_url: null,
              }
            : null;
        })()
      : null);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {propsState.status ? (
          <button
            type="button"
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
            onClick={() => setPinnedOpen(true)}
            className="focus-visible:ring-ring inline-flex cursor-pointer items-center rounded-full transition-opacity duration-150 hover:opacity-85 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={isVi ? "Thông tin & Thuộc tính trang" : "Page info & properties"}
          >
            <PageStatusPill
              status={propsState.status}
              locale={locale}
              className="px-2.5 py-0.5 text-xs"
            />
          </button>
        ) : (
          <button
            type="button"
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
            onClick={() => setPinnedOpen(true)}
            className={cn(
              "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              open && "border-primary/40 bg-primary-subtle text-primary",
              hasProps && !open && "text-foreground/75",
            )}
            title={hasProps ? undefined : isVi ? "Thêm thuộc tính trang" : "Add page properties"}
            aria-label={isVi ? "Thông tin & Thuộc tính trang" : "Page info & properties"}
          >
            <Info className="size-4 shrink-0" aria-hidden />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align={align}
        sideOffset={8}
        collisionPadding={12}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={handleHoverLeave}
        className={cn(
          "bg-surface-raised border-border-strong shadow-xl ring-1 ring-black/5 dark:ring-white/10 text-xs",
          editing ? "w-76 space-y-2.5 p-3" : "w-64 p-3",
        )}
      >
        {!editing ? (
          hasProps ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {isVi ? "Thông tin trang" : "Page info"}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPinnedOpen(true);
                      setEditing(true);
                    }}
                    className="text-primary hover:bg-primary-subtle inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors"
                  >
                    <Pencil className="size-3" />
                    {isVi ? "Sửa" : "Edit"}
                  </button>
                ) : null}
              </div>

              {(ownerInfo || (propsState.custom?.length ?? 0) > 0) ? (
                <dl className="border-border space-y-1.5 border-t pt-2 text-xs">
                  {ownerInfo ? (
                    <div className="grid grid-cols-[68px_1fr] items-center gap-2">
                      <dt className="text-muted-foreground text-[11px]">
                        {isVi ? "Phụ trách" : "Owner"}
                      </dt>
                      <dd className="min-w-0">
                        <UserProfileTrigger
                          username={ownerInfo.username}
                          fullName={ownerInfo.full_name}
                          openOnHover
                          className="inline-flex max-w-full items-center gap-1.5 font-medium text-foreground no-underline hover:underline"
                        >
                          <Avatar
                            name={ownerInfo.full_name}
                            username={ownerInfo.username}
                            src={ownerInfo.avatar_url}
                            className="size-4 shrink-0 text-[9px]"
                          />
                          <span className="truncate">
                            {ownerInfo.full_name || ownerInfo.username}
                          </span>
                        </UserProfileTrigger>
                      </dd>
                    </div>
                  ) : null}

                  {(propsState.custom ?? []).map((item, idx) => (
                    <div
                      key={`${item.key}-${idx}`}
                      className="grid grid-cols-[68px_1fr] items-start gap-2"
                    >
                      <dt
                        className="text-muted-foreground truncate text-[11px]"
                        title={item.key}
                      >
                        {item.key}
                      </dt>
                      <dd className="text-foreground break-words font-medium">
                        {item.value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="border-border text-muted-foreground border-t pt-2 text-[11px]">
                  {isVi
                    ? "Chưa gán người phụ trách hoặc thông tin bổ sung."
                    : "No owner or extra metadata yet."}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground py-1 text-center text-xs">
              {isVi
                ? "Chưa có thuộc tính nào."
                : "No properties set."}
            </p>
          )
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">
                {isVi ? "Thuộc tính trang" : "Page properties"}
              </span>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer rounded p-0.5 transition-colors"
                aria-label={isVi ? "Đóng" : "Close"}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-muted-foreground block font-medium">
                {isVi ? "Trạng thái" : "Status"}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDraftStatus("")}
                  className={cn(
                    "cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-hover",
                    draftStatus === ""
                      ? "border-primary bg-primary-subtle text-primary font-medium"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {isVi ? "Không chọn" : "None"}
                </button>
                {PAGE_STATUS_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDraftStatus(opt.value)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-90",
                        opt.badgeClass,
                        draftStatus === opt.value &&
                          "ring-primary ring-2 ring-offset-1 ring-offset-background",
                      )}
                    >
                      <Icon className="size-3 shrink-0" aria-hidden />
                      {isVi ? opt.labelVi : opt.labelEn}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground block font-medium">
                {isVi ? "Người phụ trách" : "Owner"}
              </label>
              <select
                value={draftOwnerId}
                onChange={(e) => setDraftOwnerId(e.target.value)}
                className="border-border bg-background text-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-full rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="">
                  {isVi ? "— Chưa gán —" : "— Unassigned —"}
                </option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || m.username} (@{m.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground block font-medium">
                {isVi
                  ? "Thuộc tính tùy chỉnh (Tên trường → Giá trị)"
                  : "Custom metadata (Field → Value)"}
              </label>
              {draftCustom.length > 0 ? (
                <div className="space-y-1.5">
                  {draftCustom.map((item, idx) => (
                    <div
                      key={`${item.key}-${idx}`}
                      className="flex items-center gap-1.5"
                    >
                      <Input
                        value={item.key}
                        onChange={(e) =>
                          setDraftCustom((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, key: e.target.value } : row,
                            ),
                          )
                        }
                        className="h-7 flex-1 text-xs"
                        placeholder={isVi ? "Tên trường" : "Field"}
                      />
                      <Input
                        value={item.value}
                        onChange={(e) =>
                          setDraftCustom((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? { ...row, value: e.target.value }
                                : row,
                            ),
                          )
                        }
                        className="h-7 flex-1 text-xs"
                        placeholder={isVi ? "Giá trị" : "Value"}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftCustom((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        className="text-muted-foreground hover:bg-danger/10 hover:text-danger cursor-pointer rounded p-1 transition-colors"
                        aria-label={isVi ? "Xóa trường" : "Remove field"}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomField();
                    }
                  }}
                  className="h-7 flex-1 text-xs"
                  placeholder={isVi ? "VD: Hệ thống" : "e.g. System"}
                />
                <Input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomField();
                    }
                  }}
                  className="h-7 flex-1 text-xs"
                  placeholder={isVi ? "VD: Core ERP" : "e.g. Core ERP"}
                />
                <button
                  type="button"
                  onClick={handleAddCustomField}
                  disabled={!newKey.trim()}
                  className="border-border bg-surface-sunken text-foreground hover:bg-surface-hover flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-40"
                  title={isVi ? "Thêm thuộc tính" : "Add field"}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="border-border flex items-center justify-end gap-2 border-t pt-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (hasProps) setEditing(false);
                  else handleOpenChange(false);
                }}
              >
                {isVi ? "Hủy" : "Cancel"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={handleSave}
              >
                <Check className="size-3.5" />
                {saving
                  ? isVi
                    ? "Đang lưu..."
                    : "Saving..."
                  : isVi
                    ? "Lưu"
                    : "Save"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
