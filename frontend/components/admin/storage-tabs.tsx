"use client";

import { FolderOpen, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { StoragePanel } from "@/components/admin/storage-panel";
import { StorageQuotasCard } from "@/components/admin/storage-quotas-card";
import { cn } from "@/lib/utils";
import type { SiteSettings } from "@/types/api";

const STORAGE_SECTIONS: Array<{ id: "browse" | "settings"; label: string; icon: LucideIcon }> = [
  { id: "browse", label: "Browse files", icon: FolderOpen },
  { id: "settings", label: "Quotas", icon: SlidersHorizontal },
];

/**
 * Admin > Storage split into two sections, styled after the same sidebar
 * layout as Admin > Backup: browsing/monitoring the bucket (what this page
 * is opened for most of the time) and the quota settings that govern it (an
 * occasional edit). Both panels stay mounted and are toggled with `hidden`
 * rather than conditionally rendered, so switching sections never re-fetches
 * the object list or loses an in-progress quota edit.
 */
export function StorageTabs({ settings }: { settings: SiteSettings }) {
  const [activeSection, setActiveSection] = useState<"browse" | "settings">("browse");

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside
        aria-label="Storage sections"
        className="border-border border-r pr-5 lg:sticky lg:top-24"
      >
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          Storage sections
        </p>
        <div className="mt-3 space-y-1">
          {STORAGE_SECTIONS.map(({ id, label, icon: Icon }) => {
            const selected = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-ring",
                  selected
                    ? "bg-surface-selected text-primary font-semibold hover:bg-surface-hover"
                    : "text-muted-foreground font-normal hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main content */}
      <div className="min-w-0 space-y-6">
        <div className={cn(activeSection !== "browse" && "hidden")}>
          <StoragePanel />
        </div>
        <div className={cn(activeSection !== "settings" && "hidden")}>
          <StorageQuotasCard settings={settings} />
        </div>
      </div>
    </div>
  );
}
