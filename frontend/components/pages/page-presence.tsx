"use client";

import { Eye, Pencil, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PresenceUser } from "@/types/api";

interface PagePresenceProps {
  users: PresenceUser[];
  className?: string;
  maxVisible?: number;
  showLabel?: boolean;
}

export function PagePresence({
  users,
  className,
  maxVisible = 4,
  showLabel = true,
}: PagePresenceProps) {
  const { t } = useTranslation();

  if (!users || users.length === 0) {
    return null;
  }

  const displayedUsers = users.slice(0, maxVisible);
  const overflowCount = users.length - maxVisible;
  const editingCount = users.filter((u) => u.state === "editing").length;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border/70 bg-surface-sunken/60 py-0.5 pl-2.5 pr-1 text-xs shadow-xs transition-colors hover:border-border hover:bg-surface-sunken",
        className,
      )}
      title={t("workspace.activeUsers")}
      aria-label={t("workspace.activeUsers")}
    >
      {showLabel ? (
        <div className="flex items-center gap-1.5 select-none pr-0.5">
          {editingCount > 0 ? (
            <Pencil className="size-3 text-amber-500 shrink-0" aria-hidden />
          ) : (
            <Eye className="size-3.5 text-primary shrink-0" aria-hidden />
          )}
          <span className="text-[11px] font-medium text-foreground whitespace-nowrap">
            {editingCount > 0 ? t("workspace.presenceEditing") : t("workspace.presenceViewingLabel")}
          </span>
          <span className="text-muted-foreground/70 text-[10px] font-semibold">
            ({users.length})
          </span>
        </div>
      ) : null}

      <div className="flex items-center -space-x-1.5 overflow-visible py-0.5">
        {displayedUsers.map((user) => {
          const isEditing = user.state === "editing";
          const statusBadge = (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
                isEditing
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {isEditing
                ? t("workspace.presenceEditing")
                : t("workspace.presenceViewing")}
            </span>
          );

          return (
            <UserProfileTrigger
              key={user.user_id}
              username={user.username}
              fullName={user.full_name}
              variant="avatar"
              openOnHover
              popoverAlign="end"
              statusBadge={statusBadge}
              className="relative rounded-full ring-2 ring-background transition-transform duration-150 hover:z-30 hover:scale-110 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative">
                <Avatar
                  name={user.full_name}
                  username={user.username}
                  src={user.avatar_url}
                  className={cn(
                    "size-7 text-[10px] shadow-xs select-none",
                    isEditing && "ring-1 ring-amber-500",
                  )}
                />
                {isEditing ? (
                  <span
                    className="bg-amber-500 text-white absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full ring-1 ring-background shadow-xs"
                    title={t("workspace.presenceEditing")}
                  >
                    <Pencil className="size-1.5" />
                  </span>
                ) : null}
              </div>
            </UserProfileTrigger>
          );
        })}

        {overflowCount > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ring-2 ring-background bg-surface-sunken hover:bg-surface-hover text-muted-foreground hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-xs font-semibold transition-transform duration-150 hover:z-30 hover:scale-110 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                title={t("workspace.activeUsers")}
                aria-label={t("workspace.activeUsers")}
              >
                +{overflowCount}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 p-2 text-sm shadow-lg"
            >
              <div className="text-muted-foreground border-b border-border/50 mb-1 flex items-center justify-between px-2 pb-2 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  <span>{t("workspace.activeUsers")}</span>
                </div>
                <span className="text-muted-foreground text-[11px] font-normal">
                  {users.length}
                </span>
              </div>
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {users.map((u) => {
                  const isEditing = u.state === "editing";
                  return (
                    <UserProfileTrigger
                      key={u.user_id}
                      username={u.username}
                      fullName={u.full_name}
                      variant="name"
                      openOnHover
                      popoverAlign="end"
                      statusBadge={
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
                            isEditing
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isEditing
                            ? t("workspace.presenceEditing")
                            : t("workspace.presenceViewing")}
                        </span>
                      }
                      className="w-full text-left no-underline hover:no-underline"
                    >
                      <div className="hover:bg-accent flex w-full items-center justify-between rounded-md p-1.5 transition-colors">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar
                            name={u.full_name}
                            username={u.username}
                            src={u.avatar_url}
                            className="size-7 text-[10px] select-none"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">
                              {u.full_name || u.username}
                            </p>
                            <p className="text-muted-foreground truncate text-[11px]">
                              @{u.username}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                            isEditing
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isEditing
                            ? t("workspace.presenceEditing")
                            : t("workspace.presenceViewing")}
                        </span>
                      </div>
                    </UserProfileTrigger>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}
