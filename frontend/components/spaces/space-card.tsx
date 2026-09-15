"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";

export function SpaceCard({ space }: { space: Space }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [pending, setPending] = useState(false);

  async function toggleFavorite(event: React.MouseEvent) {
    // The star sits inside a link; without this the click would navigate.
    event.preventDefault();
    event.stopPropagation();

    const next = !favorite;
    setFavorite(next); // optimistic
    setPending(true);
    try {
      const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/favorite`;
      if (next) {
        await api.put<void>(path);
      } else {
        await api.delete<void>(path);
      }
      router.refresh();
    } catch {
      setFavorite(!next); // roll back
      toast.error(t("spaces.favouriteError"));
    } finally {
      setPending(false);
    }
  }

  const favouriteLabel = favorite
    ? t("spaces.removeFavourite")
    : t("spaces.addFavourite");

  return (
    <Link
      href={`/spaces/${encodeURIComponent(space.key)}`}
      className={cn(
        "border-border bg-surface group relative block rounded-lg border p-4",
        "transition-[border-color,box-shadow,background-color] duration-150",
        "hover:border-border-strong hover:bg-surface-hover hover:shadow-sm",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-primary-subtle flex size-10 shrink-0 items-center justify-center rounded-lg text-xl leading-none"
        >
          {space.icon || "📄"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{space.name}</h3>
            <code className="text-muted-foreground bg-surface-sunken rounded px-1.5 py-0.5 font-mono text-[11px]">
              {space.key}
            </code>
            {space.status === "archived" ? (
              <span className="text-muted-foreground border-border rounded border px-1.5 py-0.5 text-[11px]">
                {t("spaces.archivedBadge")}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {space.description || t("spaces.noDescription")}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            {space.member_count === 1
              ? t("spaces.memberCountOne", { count: space.member_count })
              : t("spaces.memberCountMany", { count: space.member_count })}
            {space.my_role ? ` · ${t("spaces.youAreRole", { role: space.my_role })}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleFavorite}
          disabled={pending}
          aria-label={favouriteLabel}
          aria-pressed={favorite}
          title={favouriteLabel}
          className={cn(
            "rounded-md p-1.5 transition-colors duration-150",
            "hover:bg-surface-selected focus-visible:ring-ring cursor-pointer",
            "focus-visible:ring-2 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
            favorite
              ? "text-amber-500"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Star className={cn("size-4", favorite && "fill-current")} />
        </button>
      </div>
    </Link>
  );
}
