"use client";

import {
  KeyRound,
  MoreHorizontal,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ResetPasswordDialog } from "@/components/admin/reset-password-dialog";
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
    return (
      <span className="text-muted-foreground text-xs">Protected account</span>
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

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "text-muted-foreground hover:text-foreground cursor-pointer rounded-md p-1.5",
            "transition-colors duration-150",
            "hover:bg-surface-selected active:bg-surface-selected",
            "data-[state=open]:bg-surface-selected data-[state=open]:text-foreground",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          disabled={pending !== null}
          aria-label={`Actions for ${user.username}`}
          title={`Actions for ${user.username}`}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          // Two items open a dialog. Without this, the menu's own restore-focus
          // on close races the dialog's focus trap and the dialog can open with
          // focus back on the row's trigger button.
          onCloseAutoFocus={(event) => {
            if (resetOpen || confirmDelete) event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => setResetOpen(true)}>
            <KeyRound />
            Set a new password
          </DropdownMenuItem>

          {user.is_active ? (
            <DropdownMenuItem
              // The backend refuses self-deactivation with 409; say so here
              // rather than letting the click fail.
              disabled={isSelf}
              title={
                isSelf ? "You cannot deactivate your own account" : undefined
              }
              onSelect={() => void setActive(false)}
            >
              <UserX />
              Deactivate account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void setActive(true)}>
              <UserCheck />
              Activate account
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            destructive
            disabled={isSelf}
            title={isSelf ? "You cannot delete your own account" : undefined}
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 />
            Delete user…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
