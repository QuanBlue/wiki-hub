"use client";

import { Loader2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import type { Me, User } from "@/types/api";

export function ProfileForm({ user }: { user: Me }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const initials = (fullName.trim() || user.username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.patch<User>("/api/v1/users/me", {
        full_name: fullName.trim(),
        email: email.trim(),
        avatar_url: avatarUrl.trim() || null,
      });
      toast.success("Profile updated.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update your profile.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-xl space-y-4" noValidate>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center text-sm font-semibold"
          style={
            avatarUrl.trim()
              ? { backgroundImage: `url(${avatarUrl.trim()})` }
              : undefined
          }
        >
          {avatarUrl.trim()
            ? null
            : initials || <UserRound className="size-5" />}
        </span>
        <p className="text-muted-foreground text-sm">
          Your avatar appears in the account menu and collaboration surfaces.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input
            id="profile-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">E-mail</Label>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="profile-avatar">Avatar image URL</Label>
        <Input
          id="profile-avatar"
          type="url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://example.com/avatar.png"
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Use a direct HTTP(S) link to an image. Leave empty to use your
          initials.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        disabled={pending || !email.trim()}
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save profile
      </Button>
    </form>
  );
}
