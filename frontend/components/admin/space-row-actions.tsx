"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
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

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "text-muted-foreground hover:text-foreground cursor-pointer rounded-md p-1.5",
            "hover:bg-surface-selected active:bg-surface-selected transition-colors duration-150",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          disabled={pending}
          aria-label={`Actions for ${space.name}`}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              space.status === "active"
                ? setConfirmArchiveOpen(true)
                : void toggleArchive()
            }
          >
            {space.status === "active" ? <Archive /> : <ArchiveRestore />}
            {space.status === "active" ? "Archive space" : "Unarchive space"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
            <Trash2 />
            Delete space…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
