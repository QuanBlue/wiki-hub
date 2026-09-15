"use client";

import {
  Check,
  CheckCircle2,
  FolderPlus,
  Loader2,
  Plus,
  Search,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
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
import { useTranslation } from "@/lib/i18n/context";
import type { Space, User } from "@/types/api";

//: Mirrors the backend's rule (see `_check_name_start` in
//: `app/schemas/space.py`): a space name may not start with a digit or a
//: symbol, though any Unicode letter (including accented ones) is fine.
const NAME_START_PATTERN = /^\p{L}/u;

function deriveKey(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (!base) return "";
  // Keys must start with a letter (e.g. "123" -> "123" is rejected by the
  // API), so prefix a letter whenever the derived key would start with a
  // digit or underscore instead of silently failing on submit.
  return /^[A-Z]/.test(base) ? base : `S${base}`.slice(0, 32);
}

export function CreateSpaceForm({ users = [] }: { users?: User[] }) {
  const router = useRouter();
  const { t, apiErrorText } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"open" | "restricted">("open");
  const [ownerId, setOwnerId] = useState(users[0]?.id ?? "");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const key = deriveKey(name);
  const trimmedName = name.trim();
  const isDuplicateName =
    !!trimmedName && existingNames.has(trimmedName.toLowerCase());
  const nameError = !trimmedName
    ? null
    : !NAME_START_PATTERN.test(trimmedName)
      ? t("spaces.nameError")
      : isDuplicateName
        ? t("spaces.duplicateName", { name: trimmedName })
        : null;
  const normalizedMemberQuery = memberQuery.trim().toLowerCase();
  const filteredUsers = users.filter(
    (user) =>
      !normalizedMemberQuery ||
      `${user.full_name} ${user.username} ${user.email}`
        .toLowerCase()
        .includes(normalizedMemberQuery),
  );

  // Load existing space names to catch a duplicate before submit, rather
  // than surfacing it as a conflict only after the request round-trips.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<Space[]>("/api/v1/spaces", {
        query: { include_archived: true, limit: 200 },
      })
      .then((spaces) => {
        if (!cancelled) {
          setExistingNames(
            new Set(spaces.map((space) => space.name.trim().toLowerCase())),
          );
        }
      })
      .catch(() => {
        // Best-effort: if this fails, the duplicate check is simply skipped
        // and the backend's own conflict check still catches it on submit.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setName("");
    setDescription("");
    setVisibility("open");
    setOwnerId(users[0]?.id ?? "");
    setMemberQuery("");
    setSelectedUserIds([]);
    setError(null);
  }

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
    if (!trimmedName || !key || nameError) return;
    setPending(true);
    setError(null);
    try {
      const space = await api.post<Space>("/api/v1/spaces", {
        key,
        name: name.trim(),
        description: description.trim(),
        icon: "",
        visibility,
      });
      if (users.length > 0 && ownerId) {
        try {
          await api.put(
            `/api/v1/spaces/${encodeURIComponent(space.key)}/members`,
            { user_id: ownerId, role: "admin" },
          );
          await Promise.all(
            selectedUserIds
              .filter((userId) => userId !== ownerId)
              .map((userId) =>
                api.put(
                  `/api/v1/spaces/${encodeURIComponent(space.key)}/members`,
                  { user_id: userId, role: "viewer" },
                ),
              ),
          );
        } catch (membershipError) {
          toast.error(
            membershipError instanceof ApiError
              ? t("spaces.membersPartialError", {
                  message: membershipError.message,
                })
              : t("spaces.membersPartialErrorPlain"),
          );
          setOpen(false);
          reset();
          router.refresh();
          return;
        }
      }
      toast.success(t("spaces.createdToast", { name: space.name }));
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      const message = apiErrorText(err, "spaces.createError");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        {t("spaces.createSpace")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !pending) reset();
        }}
      >
        <DialogContent
          className="max-w-xl"
          title={t("spaces.createTitle")}
          description={t("spaces.createDescription")}
        >
          <div className="bg-primary-subtle text-primary mb-5 flex items-start gap-3 rounded-md px-3 py-2.5">
            <FolderPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="text-xs leading-5">
              <p className="font-medium">
                {t("spaces.spaceKeyLabel", { key: key || "—" })}
              </p>
              <p className="text-primary/80">
                {t("spaces.spaceKeyHint")}
              </p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-space-name">{t("spaces.nameLabel")}</Label>
                <div className="relative">
                  <Input
                    id="new-space-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("spaces.namePlaceholder")}
                    required
                    autoFocus
                    disabled={pending}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? "new-space-name-error" : undefined}
                    className="pr-9"
                  />
                  {trimmedName ? (
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
                      {nameError ? (
                        <XCircle
                          className="text-danger size-4"
                          aria-hidden
                        />
                      ) : (
                        <CheckCircle2
                          className="text-success size-4"
                          aria-hidden
                        />
                      )}
                    </span>
                  ) : null}
                </div>
                {nameError ? (
                  <p id="new-space-name-error" className="text-danger text-xs">
                    {nameError}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {t("spaces.nameHint")}
                  </p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-space-description">
                  {t("spaces.descriptionLabel")}{" "}
                  <span className="text-muted-foreground font-normal">
                    {t("spaces.optionalSuffix")}
                  </span>
                </Label>
                <Input
                  id="new-space-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("spaces.descriptionPlaceholder")}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-space-visibility">{t("spaces.accessLabel")}</Label>
                <Select
                  value={visibility}
                  onValueChange={(value) =>
                    setVisibility(value as "open" | "restricted")
                  }
                  disabled={pending}
                >
                  <SelectTrigger
                    id="new-space-visibility"
                    aria-label={t("spaces.accessAria")}
                  >
                    <SelectValue>
                      {visibility === "open"
                        ? t("spaces.accessOpen")
                        : t("spaces.accessRestricted")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">
                      {t("spaces.accessOpen")}
                    </SelectItem>
                    <SelectItem value="restricted">
                      {t("spaces.accessRestricted")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {users.length > 0 ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="new-space-owner">{t("spaces.ownerLabel")}</Label>
                  <Select
                    value={ownerId}
                    onValueChange={(value) => {
                      setOwnerId(value);
                      setSelectedUserIds((current) =>
                        current.filter((id) => id !== value),
                      );
                    }}
                    disabled={pending}
                  >
                    <SelectTrigger
                      id="new-space-owner"
                      aria-label={t("spaces.ownerAria")}
                    >
                      <SelectValue placeholder={t("spaces.chooseOwner")}>
                        {users.find((user) => user.id === ownerId)?.full_name ||
                          users.find((user) => user.id === ownerId)?.username ||
                          t("spaces.chooseOwner")}
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
                </div>
              ) : null}
              {users.length > 0 ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <Label htmlFor="new-space-members">{t("spaces.membersLabel")}</Label>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("spaces.membersHint")}
                      </p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t("spaces.selectedCount", { count: selectedUserIds.length })}
                    </span>
                  </div>
                  <div className="relative mt-2">
                    <Search
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                      aria-hidden
                    />
                    <Input
                      id="new-space-members"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder={t("spaces.membersFilterPlaceholder")}
                      className="pl-8"
                      disabled={pending}
                      aria-label={t("spaces.filterUsersAria")}
                    />
                  </div>
                  <div
                    className="border-border bg-surface max-h-48 overflow-y-auto rounded-md border"
                    role="group"
                    aria-label={t("spaces.membersGroupAria")}
                  >
                    {filteredUsers.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-3 text-sm">
                        {t("spaces.noUsersMatch")}
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
                              checked={checked || isOwner}
                              disabled={pending || isOwner}
                              onChange={() => toggleMember(user.id)}
                              className="accent-primary border-border focus-visible:ring-ring size-4 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={t("spaces.addUserAria", {
                                name: user.full_name || user.username,
                              })}
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
                                {t("spaces.ownerBadge")}
                              </span>
                            ) : null}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
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
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pending || !trimmedName || !key || !!nameError}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("spaces.createSpace")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
