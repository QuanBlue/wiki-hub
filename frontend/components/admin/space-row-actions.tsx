"use client";

import { Globe2, LockKeyhole, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { Badge } from "@/components/ui/badge";
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

export function AdminSpaceRow({
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
    <>
      <tr className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
        <td className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md text-base">
              {space.icon || "◆"}
            </span>
            <div className="min-w-0">
              <Link
                href={`/spaces/${encodeURIComponent(space.key)}`}
                className="text-primary hover:text-primary-hover block truncate font-medium hover:underline text-left"
              >
                {space.name}
              </Link>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {space.description || space.key}
              </p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="flex items-center gap-2">
            {space.visibility === "open" ? (
              <Globe2 className="text-muted-foreground size-3.5" />
            ) : (
              <LockKeyhole className="text-muted-foreground size-3.5" />
            )}
            <span>
              {space.visibility === "open" ? "Public" : "Private"}
            </span>
          </span>
        </td>
        <td className="text-muted-foreground px-2 py-3 text-center">
          {space.group_permission_count}
        </td>
        <td className="text-muted-foreground px-2 py-3 text-center">
          {space.direct_user_permission_count}
        </td>
        <td className="py-3 pr-4 pl-8">
          <Badge
            variant={space.status === "active" ? "success" : "warning"}
          >
            {space.status === "active" ? "Active" : "Archived"}
          </Badge>
        </td>
        <td className="px-4 py-3">
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
          </div>
        </td>
      </tr>

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
    </>
  );
}
