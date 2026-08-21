"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";
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
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDeleteSpace() {
    setPending(true);
    try {
      await api.delete<void>(`/api/v1/spaces/${encodeURIComponent(space.key)}`);
      toast.success(`Deleted space "${space.name}".`);
      setConfirmDeleteOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not delete this space.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setEditOpen(true)}
        aria-label={"Edit " + space.name}
      >
        <Pencil className="size-4" />
        Edit
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setConfirmDeleteOpen(true)}
        title={"Delete " + space.name}
        aria-label={"Delete " + space.name}
        className="hover:bg-danger-bg hover:text-danger cursor-pointer"
      >
        <Trash2 className="size-4" />
      </Button>

      <EditSpaceModal
        space={space}
        users={users}
        groups={groups}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${space.name}?`}
        description="This permanently removes the space, all its pages, memberships, and associated data. This action cannot be undone."
        confirmLabel="Delete space"
        destructive
        pending={pending}
        onConfirm={() => void handleDeleteSpace()}
      />
    </div>
  );
}
