"use client";

import { Check, Loader2, Plus, Search, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import type { Group, User } from "@/types/api";

export function CreateGroupDialog({
  users,
  onCreated,
}: {
  users: User[];
  onCreated: (group: Group) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(users[0]?.id ?? "");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    users[0]?.id ? [users[0].id] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setOwnerId(users[0]?.id ?? "");
    setMemberQuery("");
    setSelectedUserIds(users[0]?.id ? [users[0].id] : []);
    setError(null);
  }

  const normalizedMemberQuery = memberQuery.trim().toLowerCase();
  const filteredUsers = users.filter((user) =>
    !normalizedMemberQuery
      ? true
      : `${user.full_name} ${user.username} ${user.email}`
          .toLowerCase()
          .includes(normalizedMemberQuery),
  );

  function toggleMember(userId: string) {
    if (userId === ownerId) return;
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !ownerId) return;
    setPending(true);
    setError(null);
    try {
      const group = await api.post<Group>("/api/v1/groups", {
        name: name.trim(),
        description: description.trim(),
        owner_id: ownerId,
      });
      const memberIds = selectedUserIds.filter((userId) => userId !== ownerId);
      try {
        await Promise.all(
          memberIds.map((userId) =>
            api.put(`/api/v1/groups/${group.id}/members`, { user_id: userId }),
          ),
        );
      } catch (memberError) {
        onCreated({
          ...group,
          member_count: group.member_count + memberIds.length,
        });
        setError(
          memberError instanceof ApiError
            ? `Group created, but some members could not be added: ${memberError.message}`
            : "Group created, but some members could not be added.",
        );
        return;
      }
      onCreated({
        ...group,
        member_count: group.member_count + memberIds.length,
      });
      toast.success(`Group "${group.name}" created.`);
      setOpen(false);
      reset();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create group.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        Create group
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !pending) reset();
        }}
      >
        <DialogContent
          className="max-w-lg"
          title="Create a group"
          description="Create a reusable team for workspace access, then manage its members and permissions from the directory."
        >
          <div className="bg-primary-subtle text-primary mb-5 flex items-start gap-3 rounded-md px-3 py-2.5">
            <UsersRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-xs leading-5">
              Every group needs an owner. The owner is added as a member
              automatically.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-group-name">Group name</Label>
                <Input
                  id="new-group-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Engineering"
                  autoFocus
                  required
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-group-description">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="new-group-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="People who build and maintain the product"
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-group-owner">Owner</Label>
                <Select
                  value={ownerId}
                  onValueChange={(value) => {
                    setOwnerId(value);
                    setSelectedUserIds((current) =>
                      current.includes(value) ? current : [...current, value],
                    );
                  }}
                  disabled={users.length === 0 || pending}
                >
                  <SelectTrigger id="new-group-owner" aria-label="Group owner">
                    <SelectValue placeholder="Choose an owner">
                      {users.find((user) => user.id === ownerId)?.full_name ||
                        users.find((user) => user.id === ownerId)?.username ||
                        "Choose an owner"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.full_name || user.username} (@{user.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {users.length === 0 ? (
                  <p className="text-danger text-xs">
                    Create a user before creating a group.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <Label htmlFor="new-group-members">Members</Label>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Select one or more people to add after the group is
                      created.
                    </p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {Math.max(
                      0,
                      selectedUserIds.length -
                        (selectedUserIds.includes(ownerId) ? 1 : 0),
                    )}{" "}
                    selected
                  </span>
                </div>
                <div className="relative mt-2">
                  <Search
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <Input
                    id="new-group-members"
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="Filter users by name, username or e-mail"
                    className="pl-8"
                    disabled={pending || users.length === 0}
                    aria-label="Filter users"
                  />
                </div>
                <div
                  className="border-border bg-surface max-h-48 overflow-y-auto rounded-md border"
                  role="group"
                  aria-label="Group members"
                >
                  {filteredUsers.length === 0 ? (
                    <p className="text-muted-foreground px-3 py-3 text-sm">
                      No users match this filter.
                    </p>
                  ) : (
                    filteredUsers.map((user) => {
                      const checked = selectedUserIds.includes(user.id);
                      const isOwner = user.id === ownerId;
                      return (
                        <label
                          key={user.id}
                          className="hover:bg-surface-hover border-border flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending || isOwner}
                            onChange={() => toggleMember(user.id)}
                            className="accent-primary border-border focus-visible:ring-ring size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Add ${user.full_name || user.username}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {user.full_name || user.username}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              @{user.username} · {user.email}
                            </span>
                          </span>
                          {isOwner ? (
                            <span className="text-primary flex shrink-0 items-center gap-1 text-xs font-medium">
                              <Check className="size-3.5" />
                              Owner
                            </span>
                          ) : null}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            {error ? (
              <p
                role="alert"
                className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pending || !name.trim() || !ownerId}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Plus />}
                Create group
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
