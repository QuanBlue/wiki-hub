"use client";

import { KeyRound, Trash2, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ResetPasswordDialog } from "@/components/admin/reset-password-dialog";
import { RowActionsMenu, type RowAction } from "@/components/admin/row-actions-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";
import type { User } from "@/types/api";

/**
 * Per-row administrative actions, behind one menu.
 *
 * Three buttons per row put a delete control one stray click from every row
 * and made the table's widest column its least important one. A menu also
 * gives each action room for a full label, so "Password" no longer has to
 * stand in for "set a new password".
 *
 * For the protected bootstrap account the menu is **absent**, not disabled:
 * the backend answers 403 for every one of these, so a greyed-out menu would
 * only invite a click that cannot succeed. The badge in the Role column says
 * why.
 */
export function UserRowActions({
  user,
  isSelf,
}: {
  user: User;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  if (user.is_protected) {
    // The "protected" badge next to the name already explains why (with a
    // tooltip); repeating the explanation here would just be noise for a
    // column that otherwise holds a menu.
    return (
      <div className="flex justify-end">
        <span className="text-muted-foreground text-sm">—</span>
      </div>
    );
  }

  async function setActive(active: boolean) {
    setPending(active ? "activate" : "deactivate");
    try {
      await api.patch<User>(`/api/v1/users/${user.id}`, { is_active: active });
      toast.success(
        active
          ? `${user.username} activated.`
          : `${user.username} deactivated.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not update the user.",
      );
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    setPending("delete");
    try {
      await api.delete<void>(`/api/v1/users/${user.id}`);
      toast.success(`${user.username} deleted.`);
      setConfirmDelete(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not delete the user.",
      );
    } finally {
      setPending(null);
    }
  }

  const actions: RowAction[] = [
    { label: "Set a new password", icon: <KeyRound className="size-4" />, onSelect: () => setResetOpen(true), disabled: pending !== null },
    user.is_active
      ? { label: "Deactivate account", icon: <UserX className="size-4" />, onSelect: () => void setActive(false), disabled: pending !== null || isSelf, title: isSelf ? "You cannot deactivate your own account" : undefined }
      : { label: "Activate account", icon: <UserCheck className="size-4" />, onSelect: () => void setActive(true), disabled: pending !== null },
    { separator: true },
    { label: "Delete user…", icon: <Trash2 className="size-4" />, onSelect: () => setConfirmDelete(true), disabled: pending !== null || isSelf, destructive: true, title: isSelf ? "You cannot delete your own account" : undefined },
  ];

  return (
    <div className="flex justify-end">
      <RowActionsMenu label={`Actions for ${user.username}`} actions={actions} />

      <ResetPasswordDialog
        user={user}
        open={resetOpen}
        onOpenChange={setResetOpen}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${user.username}?`}
        description="This permanently removes the account and its space memberships. It cannot be undone. Deactivating instead keeps the account and its history."
        confirmLabel="Delete user"
        destructive
        pending={pending === "delete"}
        onConfirm={remove}
      />
    </div>
  );
}
