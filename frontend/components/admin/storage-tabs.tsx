"use client";

import { FolderOpen, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { StoragePanel } from "@/components/admin/storage-panel";
import { StorageQuotasCard } from "@/components/admin/storage-quotas-card";
import { cn } from "@/lib/utils";
import type { SiteSettings } from "@/types/api";

const TABS: Array<{ id: "browse" | "settings"; label: string; icon: LucideIcon }> = [
  { id: "browse", label: "Browse", icon: FolderOpen },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
];

/**
 * Admin > Storage split into two sections: browsing/monitoring the bucket
 * (what this page is opened for most of the time) and the quota settings
 * that govern it (an occasional edit). Both panels stay mounted and are
 * toggled with `hidden` rather than conditionally rendered, so switching
 * tabs never re-fetches the object list or loses an in-progress quota edit.
 */
export function StorageTabs({ settings }: { settings: SiteSettings }) {
  const [tab, setTab] = useState<"browse" | "settings">("browse");

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Object storage sections"
        className="border-border bg-surface-sunken inline-flex gap-1 rounded-lg border p-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`storage-${id}-panel`}
              onClick={() => setTab(id)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground focus-visible:ring-ring",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>

      <div id="storage-browse-panel" role="tabpanel" className={cn(tab !== "browse" && "hidden")}>
        <StoragePanel />
      </div>
      <div
        id="storage-settings-panel"
        role="tabpanel"
        className={cn(tab !== "settings" && "hidden")}
      >
        <StorageQuotasCard settings={settings} />
      </div>
    </div>
  );
}
