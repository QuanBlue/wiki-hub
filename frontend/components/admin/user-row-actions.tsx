"use client";

import { Pencil, ShieldOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { resetUserTwoFactor } from "@/lib/two-factor";
import { cn } from "@/lib/utils";
import type { User } from "@/types/api";

/**
 * Per-row administrative actions: Edit (role, status, password and
 * permission overrides, all in one modal - see `EditUserDialog`),
 * Reset 2FA (when TOTP is enabled on the user), and Delete, matching
 * the Edit/Delete pair `GroupManager`'s rows already use.
 *
 * For the protected bootstrap account all buttons are **absent**, not
 * disabled: the backend answers 403 for every one of these, so a greyed-out
 * button would only invite a click that cannot succeed. The "protected"
 * badge next to the name already says why.
 *
 * An Administrator row that is not the viewer's own account is disabled
 * instead, unless the viewer is themselves the protected super
 * administrator - see `AuthService.assert_peer_admin_editable` on the
 * backend, which is the actual source of truth this only mirrors.
 */
export function UserRowActions({
  user,
  isSelf,
  viewerIsProtected,
  viewerIsSystemAdmin,
}: {
  user: User;
  isSelf: boolean;
  viewerIsProtected: boolean;
  /** Whether the signed-in viewer is a System Administrator themselves
   * (`is_superuser`, or the `system_admin` global permission) - a
   * `manage_users` grant alone is not enough to change Role or Global
   * Access overrides on anyone, including this row - see
   * `AuthService.assert_actor_is_system_admin` on the backend. */
  viewerIsSystemAdmin: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [reset2faPending, setReset2faPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset2fa, setConfirmReset2fa] = useState(false);

  if (user.is_protected) {
    return (
      <div className="flex justify-end">
        <span className="text-muted-foreground text-sm">—</span>
      </div>
    );
  }

  const peerAdminBlocked = user.is_superuser && !isSelf && !viewerIsProtected;
  const peerAdminTitle = "Only the built-in super administrator can edit another administrator's account.";

  async function remove() {
    setPending(true);
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
      setPending(false);
    }
  }

  async function handleReset2fa() {
    setReset2faPending(true);
    try {
      await resetUserTwoFactor(user.id);
      toast.success(
        t("adminUsers.resetTwoFactorSuccess", { username: user.username }),
      );
      setConfirmReset2fa(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("adminUsers.resetTwoFactorError"),
      );
    } finally {
      setReset2faPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditOpen(true)}
        disabled={peerAdminBlocked}
        title={peerAdminBlocked ? peerAdminTitle : undefined}
        aria-label={`Edit ${user.username}`}
        className="not-disabled:hover:bg-surface-selected!"
      >
        <Pencil />
        Edit
      </Button>
      {user.totp_enabled ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setConfirmReset2fa(true)}
          disabled={peerAdminBlocked}
          title={
            peerAdminBlocked
              ? peerAdminTitle
              : t("adminUsers.resetTwoFactorAction", { username: user.username })
          }
          aria-label={t("adminUsers.resetTwoFactorAction", {
            username: user.username,
          })}
          className={cn(
            "hover:bg-warning-bg! hover:text-warning!",
            peerAdminBlocked &&
              "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
          )}
        >
          <ShieldOff />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setConfirmDelete(true)}
        disabled={isSelf || peerAdminBlocked}
        title={
          isSelf
            ? "You cannot delete your own account"
            : peerAdminBlocked
              ? peerAdminTitle
              : `Delete ${user.username}`
        }
        aria-label={`Delete ${user.username}`}
        className={cn(
          "hover:bg-danger-bg! hover:text-danger!",
          (isSelf || peerAdminBlocked) &&
            "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-inherit",
        )}
      >
        <Trash2 />
      </Button>

      <EditUserDialog
        user={user}
        isSelf={isSelf}
        viewerIsSystemAdmin={viewerIsSystemAdmin}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ConfirmDialog
        open={confirmReset2fa}
        onOpenChange={setConfirmReset2fa}
        title={t("adminUsers.resetTwoFactorTitle", { username: user.username })}
        description={t("adminUsers.resetTwoFactorDescription", {
          username: user.username,
        })}
        confirmLabel={t("adminUsers.resetTwoFactorConfirm")}
        destructive
        pending={reset2faPending}
        onConfirm={handleReset2fa}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${user.username}?`}
        description="This permanently removes the account and its space memberships. It cannot be undone. Deactivating instead (from Edit) keeps the account and its history."
        confirmLabel="Delete user"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </div>
  );
}
