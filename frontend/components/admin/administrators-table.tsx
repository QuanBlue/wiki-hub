"use client";

import { ShieldAlert, ShieldCheck, UserMinus, Users2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";
import type { AdminAccount } from "@/types/api";

const SOURCE_LABEL: Record<AdminAccount["admin_source"], string> = {
  superuser: "Administrator role",
  override: "Permission override",
  group: "Group membership",
};
const SOURCE_HINT: Record<AdminAccount["admin_source"], string> = {
  superuser: "This account's Role is set to Administrator.",
  override: "Not an Administrator account, but system_admin is force-enabled for this user specifically.",
  group: "Granted through a group that holds the System administrator global permission.",
};

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

/**
 * Every account that currently holds `system_admin`, however it got there -
 * `is_superuser` directly, a group's global permission, or a per-user
 * override (see `PermissionService.list_effective_system_admins`). The
 * People directory's Role filter only ever showed the first of these three.
 *
 * Each row also names who is responsible: `granted_by` (an actor's username,
 * read off the audit trail) for a `superuser`/`override` grant, or
 * `granted_via_group` (the group's own name) for a `group` one - there is no
 * individual actor to blame there, since group membership and a group's
 * permission grants aren't audited per member. Either can still be `null` -
 * an account that has held its access since before the audit trail existed,
 * or a fixture/import/seed path that never went through `AuthService`.
 */
export function AdministratorsTable({
  admins,
  meId,
  viewerIsProtected,
}: {
  admins: AdminAccount[];
  meId: string | undefined;
  viewerIsProtected: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminAccount | null>(null);

  const isLastAdmin = admins.length <= 1;

  async function demote(account: AdminAccount) {
    setPendingId(account.id);
    try {
      if (account.admin_source === "superuser") {
        await api.patch(`/api/v1/users/${account.id}`, { is_superuser: false });
      } else {
        await api.patch(`/api/v1/users/${account.id}`, {
          global_permission_overrides: { system_admin: false },
        });
      }
      toast.success(`${account.username} is no longer a system administrator.`);
      setTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not change this account's access.",
      );
    } finally {
      setPendingId(null);
    }
  }

  if (admins.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <ShieldAlert className="text-danger mx-auto size-7" />
        <p className="mt-3 font-medium">No system administrator</p>
        <p className="text-muted-foreground mt-1 text-sm">
          This instance has nobody with system_admin access - something has gone very wrong.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
              <th className="w-[32%] px-4 py-3 font-medium">User</th>
              <th className="w-[26%] px-4 py-3 font-medium">E-mail</th>
              <th className="w-[26%] px-4 py-3 font-medium">Granted via</th>
              <th className="w-[16%] px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((account) => {
              const isSelf = account.id === meId;
              // Only the protected super administrator may act on another
              // *Administrator* (Role: Administrator, not just a group/
              // override-granted system_admin - see
              // `AuthService.assert_peer_admin_editable` on the backend,
              // which is what this mirrors).
              const peerAdminBlocked =
                account.is_superuser && !isSelf && !viewerIsProtected;
              const disableDemote =
                account.is_protected || isSelf || isLastAdmin || peerAdminBlocked;
              const title = account.is_protected
                ? "The built-in administrator account is protected."
                : isSelf
                  ? "You cannot demote your own account."
                  : isLastAdmin
                    ? "This is the only system administrator - promote another account first."
                    : peerAdminBlocked
                      ? "Only the built-in super administrator can demote another administrator."
                      : undefined;
              return (
                <tr key={account.id} className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                        {initials(account.full_name || account.username)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate font-medium">{account.full_name || account.username}</p>
                          {isSelf ? <Badge variant="info">you</Badge> : null}
                          {account.is_protected ? (
                            <Badge title="Built-in account: it cannot be modified, deactivated or deleted.">
                              protected
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">@{account.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-muted-foreground truncate px-4 py-3" title={account.email}>
                    {account.email}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5" title={SOURCE_HINT[account.admin_source]}>
                      <ShieldCheck className="text-primary size-3.5 shrink-0" />
                      <span className="text-xs">{SOURCE_LABEL[account.admin_source]}</span>
                    </div>
                    <p
                      className="text-muted-foreground mt-0.5 truncate text-xs"
                      title={account.granted_via_group ?? undefined}
                    >
                      {account.granted_by ? (
                        <>Granted by <span className="font-medium">{account.granted_by}</span></>
                      ) : account.granted_via_group ? (
                        <>Via group <span className="font-medium">{account.granted_via_group}</span></>
                      ) : (
                        "Granted by — (predates tracking)"
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disableDemote || pendingId !== null}
                        title={title}
                        onClick={() => setTarget(account)}
                        className={disableDemote ? undefined : "hover:bg-danger-bg hover:text-danger"}
                      >
                        <UserMinus />
                        Demote to Member
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={target ? `Remove ${target.username} as a system administrator?` : ""}
        description={
          target
            ? target.admin_source === "superuser"
              ? "This sets their Role to Member. They keep any access their groups grant separately."
              : "This adds a permission override that force-disables system_admin for this account, regardless of what their groups grant."
            : ""
        }
        confirmLabel="Demote to Member"
        destructive
        pending={pendingId !== null}
        onConfirm={() => target && void demote(target)}
      />
    </>
  );
}

export function AdministratorsSummary({ count }: { count: number }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Users2 className="size-3.5" />
      {count} account{count === 1 ? "" : "s"} currently hold{count === 1 ? "s" : ""} system_admin access.
    </p>
  );
}
