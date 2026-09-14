"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { GroupUsagePanel } from "@/components/admin/group-usage-panel";
import { getGroupUsage } from "@/lib/group-members";
import type { Group, GroupUsage } from "@/types/api";

/**
 * Standalone "quick view" for one group's Access grants - clicking the
 * Directory table's own count opens straight into this, not the full Edit
 * Group dialog (General details/Members/Global access), since checking or
 * clearing a Space/Page grant has nothing to do with any of those.
 */
export function GroupUsageDialog({
  group,
  open,
  onOpenChange,
  onGroupUpdated,
}: {
  group: Group | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupUpdated: (updated: Group) => void;
}) {
  const [usage, setUsage] = useState<GroupUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const prevGroupIdRef = useRef<string | null>(null);
  const prevOpenRef = useRef(false);

  async function load(groupId: string) {
    setLoading(true);
    try {
      setUsage(await getGroupUsage(groupId));
    } catch {
      // Best-effort load
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    const isJustOpened = !prevOpenRef.current;
    const isDifferentGroup = prevGroupIdRef.current !== group?.id;
    if (group && (isJustOpened || isDifferentGroup)) {
      setUsage(null);
      void load(group.id);
      prevGroupIdRef.current = group.id;
    }
    prevOpenRef.current = open;
  }, [group, open]);

  if (!group) return null;

  function handleUsageChanged(next: GroupUsage) {
    setUsage(next);
    onGroupUpdated({ ...group!, space_count: next.spaces.length, page_count: next.pages.length });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        title={`"${group.name}" — Access grants`}
        description="Every Space and Page this group is currently granted access to."
      >
        <div className="mt-1">
          <GroupUsagePanel
            group={group}
            usage={usage}
            loading={loading}
            onUsageChanged={handleUsageChanged}
          />
        </div>
        <DialogFooter className="pt-4 border-t border-border mt-4">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
