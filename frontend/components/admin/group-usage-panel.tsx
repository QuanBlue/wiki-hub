"use client";

import { Ban, FileText, FolderKanban, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Group, GroupPageUsage, GroupSpaceUsage, GroupUsage } from "@/types/api";

// `export` is a real `SpacePermission` value but not offered as its own
// toggle anywhere any more - it now follows View automatically (see
// `effective_permissions` in the backend). It can still show up here on a
// group whose grant predates that change, so it still needs a label.
const SPACE_PERMISSION_LABELS: Record<string, string> = {
  view: "View", add: "Add/Edit", delete: "Delete", delete_own: "Delete own",
  restrictions: "Restrictions", export: "Export", move: "Move", admin: "Admin",
};
const PAGE_PERMISSION_LABELS: Record<string, string> = { view: "View", edit: "Edit" };

type SubTab = "spaces" | "pages";

// Fixed so switching between Spaces/Pages never resizes the dialog around
// the viewer - a list longer than this scrolls internally instead.
const LIST_AREA_HEIGHT = "h-72";

/**
 * Every Space/Page a group is currently granted access to, split into its
 * own Spaces/Pages sub-tab, each with single-item and multi-select Remove -
 * what `delete_group`'s `group_in_use` error refers to, spelled out so an
 * operator does not have to hunt through every Space's Access panel and
 * every Page's Restrictions to find (and clear) them.
 *
 * Shared between `EditGroupDialog`'s own tab and the standalone
 * `GroupUsageDialog` opened straight from the Directory table's count, so
 * the remove logic (and its DELETE calls) exists in exactly one place.
 * Removal is immediate, not staged behind a Save button - unlike the
 * Members tab, this has no larger "pending changes" the rest of the dialog
 * needs to track, so there is nothing to gain by deferring it.
 *
 * Select mode is owned here, not by each list, so its toggle can sit next
 * to the sub-tabs instead of inside whichever list happens to be showing -
 * switching sub-tabs resets it, since a selection made on Spaces has no
 * meaning once Pages is what's on screen.
 */
export function GroupUsagePanel({
  group,
  usage,
  loading,
  onUsageChanged,
}: {
  group: Group;
  usage: GroupUsage | null;
  loading: boolean;
  onUsageChanged: (usage: GroupUsage) => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("spaces");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div className={cn(LIST_AREA_HEIGHT, "flex items-center justify-center text-center text-sm text-muted-foreground")}>
        <div>
          <Loader2 className="mx-auto size-5 animate-spin mb-2" />
          Loading...
        </div>
      </div>
    );
  }

  if (!usage || (usage.spaces.length === 0 && usage.pages.length === 0)) {
    return (
      <div className={cn(LIST_AREA_HEIGHT, "flex items-center justify-center text-center text-sm text-muted-foreground")}>
        <div>
          <FolderKanban className="mx-auto size-6 mb-2" />
          <p className="font-medium text-foreground">Not used anywhere</p>
          <p className="mt-1 text-xs">
            This group has no Space or Page access grants, so it can be deleted outright.
          </p>
        </div>
      </div>
    );
  }

  function switchSubTab(next: SubTab) {
    setSubTab(next);
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggleSelectMode() {
    setSelectMode((current) => {
      if (current) setSelected(new Set());
      return !current;
    });
  }
  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelected() {
    setSelected(new Set());
  }
  function selectAll(ids: string[]) {
    setSelected(new Set(ids));
  }
  function finishSelecting() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function removeSpace(space: GroupSpaceUsage) {
    await Promise.all(
      space.permissions.map((permission) =>
        api.delete(
          `/api/v1/spaces/${encodeURIComponent(space.space_key)}/permissions/groups/${group.id}/${permission}`,
        ),
      ),
    );
  }

  async function removePage(page: GroupPageUsage) {
    await Promise.all(
      page.entries.map((entry) => {
        const base = `/api/v1/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.page_slug)}/restrictions/groups/${group.id}/${entry.permission}`;
        return api.delete(entry.denied ? `${base}/block` : base);
      }),
    );
  }

  const activeCount = subTab === "spaces" ? usage.spaces.length : usage.pages.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div
          className="border-border bg-surface-sunken flex w-fit shrink-0 items-center rounded-md border p-0.5"
          role="tablist"
          aria-label="Access grant type"
        >
          <SubTabButton
            active={subTab === "spaces"}
            onClick={() => switchSubTab("spaces")}
            icon={FolderKanban}
          >
            Spaces ({usage.spaces.length})
          </SubTabButton>
          <SubTabButton active={subTab === "pages"} onClick={() => switchSubTab("pages")} icon={FileText}>
            Pages ({usage.pages.length})
          </SubTabButton>
        </div>
        <Button
          type="button"
          size="sm"
          variant={selectMode ? "secondary" : "ghost"}
          onClick={toggleSelectMode}
          disabled={activeCount === 0}
        >
          {selectMode ? `Cancel${selected.size ? ` (${selected.size})` : ""}` : "Select"}
        </Button>
      </div>

      {subTab === "spaces" ? (
        <UsageList<GroupSpaceUsage>
          items={usage.spaces}
          getId={(space) => space.space_id}
          getHref={(space) => `/spaces/${encodeURIComponent(space.space_key)}`}
          renderTitle={(space) => space.space_name}
          renderSubtitle={(space) => space.space_key}
          renderBadges={(space) => (
            <div className="flex flex-wrap gap-1 justify-end max-w-44">
              {space.permissions.map((permission) => (
                <Badge key={permission} variant="neutral" className="text-[10px]">
                  {SPACE_PERMISSION_LABELS[permission] ?? permission}
                </Badge>
              ))}
            </div>
          )}
          removeItem={removeSpace}
          onRemoved={(ids) =>
            onUsageChanged({ ...usage, spaces: usage.spaces.filter((s) => !ids.includes(s.space_id)) })
          }
          noun="Space"
          removeWarning="Every member of this group loses whatever this grant gave them in this Space. Re-add it from the Space's own Access panel if that was a mistake."
          emptyText="Not granted access to any Space."
          selectMode={selectMode}
          selected={selected}
          onToggleOne={toggleOne}
          onSelectAll={selectAll}
          onClearSelected={clearSelected}
          onDoneSelecting={finishSelecting}
        />
      ) : (
        <UsageList<GroupPageUsage>
          items={usage.pages}
          getId={(page) => page.page_id}
          getHref={(page) =>
            `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.page_slug)}`
          }
          renderTitle={(page) => page.page_title}
          renderSubtitle={(page) => page.space_name}
          renderBadges={(page) => (
            <div className="flex flex-wrap gap-1 justify-end max-w-44">
              {page.entries.map((entry) => (
                <Badge
                  key={entry.permission}
                  variant={entry.denied ? "danger" : "neutral"}
                  className="text-[10px] gap-1"
                >
                  {entry.denied ? <Ban className="size-2.5" /> : null}
                  {PAGE_PERMISSION_LABELS[entry.permission] ?? entry.permission}
                </Badge>
              ))}
            </div>
          )}
          removeItem={removePage}
          onRemoved={(ids) =>
            onUsageChanged({ ...usage, pages: usage.pages.filter((p) => !ids.includes(p.page_id)) })
          }
          noun="Page"
          removeWarning="Clears this group's restriction on this Page. Members fall back to whatever the Space itself grants them."
          emptyText="Not named on any Page's restrictions."
          selectMode={selectMode}
          selected={selected}
          onToggleOne={toggleOne}
          onSelectAll={selectAll}
          onClearSelected={clearSelected}
          onDoneSelecting={finishSelecting}
        />
      )}
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FolderKanban;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
        active
          ? "bg-surface text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

/**
 * One Spaces- or Pages-shaped list: a Trash icon per row for a single
 * removal, plus checkboxes, a "Select all" toggle, and a bulk-remove bar
 * while the parent's Select mode is on. Generic over the item type so the
 * two lists (different shapes, different DELETE calls) share this instead
 * of duplicating the confirm-dialog and remove wiring. Rows scroll inside a
 * fixed-height area (`LIST_AREA_HEIGHT`) so the dialog itself never resizes
 * when the two sub-tabs hold different numbers of items.
 */
function UsageList<T>({
  items,
  getId,
  getHref,
  renderTitle,
  renderSubtitle,
  renderBadges,
  removeItem,
  onRemoved,
  noun,
  removeWarning,
  emptyText,
  selectMode,
  selected,
  onToggleOne,
  onSelectAll,
  onClearSelected,
  onDoneSelecting,
}: {
  items: T[];
  getId: (item: T) => string;
  getHref: (item: T) => string;
  renderTitle: (item: T) => string;
  renderSubtitle: (item: T) => string;
  renderBadges: (item: T) => ReactNode;
  removeItem: (item: T) => Promise<void>;
  onRemoved: (ids: string[]) => void;
  noun: string;
  removeWarning: string;
  emptyText: string;
  selectMode: boolean;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelected: () => void;
  onDoneSelecting: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [singleTarget, setSingleTarget] = useState<T | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  async function handleSingleRemove(item: T) {
    const id = getId(item);
    setPendingId(id);
    try {
      await removeItem(item);
      onRemoved([id]);
      toast.success(`Removed from "${renderTitle(item)}".`);
      setSingleTarget(null);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Could not remove this ${noun}.`);
    } finally {
      setPendingId(null);
    }
  }

  async function handleBulkRemove() {
    setBulkPending(true);
    const targets = items.filter((item) => selected.has(getId(item)));
    const removedIds: string[] = [];
    let failCount = 0;
    for (const item of targets) {
      try {
        await removeItem(item);
        removedIds.push(getId(item));
      } catch {
        failCount += 1;
      }
    }
    setBulkPending(false);
    setBulkConfirmOpen(false);
    if (removedIds.length > 0) {
      onRemoved(removedIds);
      toast.success(`Removed from ${removedIds.length} ${noun}${removedIds.length === 1 ? "" : "s"}.`);
    }
    if (failCount > 0) {
      toast.error(`Could not remove from ${failCount} ${noun}${failCount === 1 ? "" : "s"}.`);
    }
    onDoneSelecting();
  }

  if (items.length === 0) {
    return (
      <div className={cn(LIST_AREA_HEIGHT, "flex items-center justify-center")}>
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const allSelected = items.length > 0 && items.every((item) => selected.has(getId(item)));

  return (
    <div className={cn(LIST_AREA_HEIGHT, "flex flex-col min-h-0 gap-2")}>
      {selectMode ? (
        <div className="bg-primary-subtle/30 border-border flex shrink-0 items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              className="border-border text-primary size-4 shrink-0 cursor-pointer rounded"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && !allSelected;
              }}
              onChange={() =>
                allSelected ? onClearSelected() : onSelectAll(items.map(getId))
              }
              aria-label={`Select all ${noun}s`}
            />
            <span className="font-medium">
              {selected.size > 0 ? `${selected.size} selected` : `Select all (${items.length})`}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClearSelected}
              disabled={selected.size === 0}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={selected.size === 0}
            >
              Remove selected
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border border-border rounded-lg divide-y divide-border bg-surface flex-1 min-h-0 overflow-y-auto">
        {items.map((item) => {
          const id = getId(item);
          return (
            <div
              key={id}
              className="flex items-center gap-3 p-2.5 hover:bg-surface-hover transition-colors"
            >
              {selectMode ? (
                <input
                  type="checkbox"
                  className="border-border text-primary size-4 shrink-0 cursor-pointer rounded"
                  checked={selected.has(id)}
                  onChange={() => onToggleOne(id)}
                  aria-label={`Select ${renderTitle(item)}`}
                />
              ) : null}
              <Link href={getHref(item)} target="_blank" className="min-w-0 flex-1 hover:underline">
                <p className="text-xs font-medium text-foreground truncate">{renderTitle(item)}</p>
                <p className="text-[10px] text-muted-foreground truncate">{renderSubtitle(item)}</p>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                {renderBadges(item)}
                {!selectMode ? (
                  <button
                    type="button"
                    onClick={() => setSingleTarget(item)}
                    disabled={pendingId !== null}
                    title={`Remove from this ${noun}`}
                    aria-label={`Remove from "${renderTitle(item)}"`}
                    className="text-muted-foreground hover:bg-danger-bg hover:text-danger shrink-0 cursor-pointer rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={singleTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingId === null) setSingleTarget(null);
        }}
        title={singleTarget ? `Remove from "${renderTitle(singleTarget)}"?` : ""}
        description={removeWarning}
        confirmLabel="Remove"
        destructive
        pending={pendingId !== null}
        onConfirm={() => {
          if (singleTarget) void handleSingleRemove(singleTarget);
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !bulkPending) setBulkConfirmOpen(false);
        }}
        title={`Remove from ${selected.size} ${noun}${selected.size === 1 ? "" : "s"}?`}
        description={removeWarning}
        confirmLabel="Remove selected"
        destructive
        pending={bulkPending}
        onConfirm={() => void handleBulkRemove()}
      />
    </div>
  );
}
