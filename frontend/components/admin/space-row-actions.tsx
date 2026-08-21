"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { Button } from "@/components/ui/button";
import type { Group, Space, User } from "@/types/api";

export function SpaceRowActions({
  space,
  users,
  groups,
}: {
  space: Space;
  users?: User[];
  groups?: Group[];
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 text-xs gap-1.5 px-3 font-medium cursor-pointer"
        onClick={() => setEditOpen(true)}
      >
        <Pencil className="size-3.5" />
        Edit
      </Button>

      <EditSpaceModal
        space={space}
        users={users}
        groups={groups}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}
