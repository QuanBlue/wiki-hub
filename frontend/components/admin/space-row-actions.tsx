"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RowActionsMenu, type RowAction } from "@/components/admin/row-actions-menu";
import { api, ApiError } from "@/lib/api-client";
import type { Space } from "@/types/api";

export function SpaceRowActions({ space }: { space: Space }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function toggleArchive() {
    setPending(true);
    const archiving = space.status === "active";
    try {
      await api.post<void>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/${archiving ? "archive" : "unarchive"}`,
      );
      toast.success(
        archiving
          ? `Archived space "${space.name}".`
          : `Restored space "${space.name}".`,
      );
      if (archiving) setConfirmArchiveOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not update this space.",
      );
    } finally {
      setPending(false);
    }
  }

  async function removeSpace() {
    setPending(true);
    try {
      await api.delete<void>(`/api/v1/spaces/${encodeURIComponent(space.key)}`);
      toast.success(`Deleted space "${space.name}".`);
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not delete this space.",
      );
    } finally {
      setPending(false);
    }
  }

  const actions: RowAction[] = [
    {
      label: space.status === "active" ? "Archive space" : "Unarchive space",
      icon: space.status === "active" ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />,
      onSelect: () => space.status === "active" ? setConfirmArchiveOpen(true) : void toggleArchive(),
      disabled: pending,
    },
    { separator: true },
    { label: "Delete space…", icon: <Trash2 className="size-4" />, onSelect: () => setConfirmOpen(true), disabled: pending, destructive: true },
  ];

  return (
    <div className="flex justify-end">
      <RowActionsMenu label={`Actions for ${space.name}`} actions={actions} />

      <ConfirmDialog
        open={confirmArchiveOpen}
        onOpenChange={setConfirmArchiveOpen}
        title={`Archive ${space.name}?`}
        description="This hides the space from normal navigation and browsing. Its pages and members remain unchanged, and an administrator can restore it later from this list."
        confirmLabel="Archive space"
        pending={pending}
        onConfirm={() => void toggleArchive()}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${space.name}?`}
        description="This permanently removes the space, all its pages, memberships, and associated data. This action cannot be undone."
        confirmLabel="Delete space"
        destructive
        pending={pending}
        onConfirm={() => void removeSpace()}
      />
    </div>
  );
}
