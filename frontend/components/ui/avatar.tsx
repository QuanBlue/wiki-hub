import { cn } from "@/lib/utils";

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300",
];

/** Consistent deterministic avatar background color for initials across the app. */
export function getUserAvatarColor(identifier: string): string {
  const trimmed = (identifier ?? "").trim();
  if (!trimmed) return AVATAR_COLORS[0]!;
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash << 5) - hash + trimmed.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/** "AB" for "Alice Brown"; falls back to the username. */
export function avatarInitials(
  name?: string | null,
  username?: string | null,
): string {
  const source = (name ?? "").trim() || (username ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]!.toUpperCase()).join("");
  return initials || "?";
}

/**
 * Normalizes avatar URLs so internal backend URLs (e.g. http://backend:8000/api/v1/users/...
 * or http://localhost:8000/api/v1/users/...) are converted to relative paths (/api/v1/users/...)
 * that the browser can reliably fetch through Next.js proxy with session cookies.
 */
export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf("/api/v1/users/");
  if (idx !== -1) {
    return trimmed.slice(idx);
  }
  return trimmed;
}

/** A round avatar: the picture when there is one, otherwise initials with consistent color. */
export function Avatar({
  name,
  username,
  src,
  className,
}: {
  name?: string | null;
  username?: string | null;
  src?: string | null;
  className?: string;
}) {
  const resolvedSrc = resolveAvatarUrl(src);
  const identifier = (username ?? "").trim() || (name ?? "").trim();
  const colorClass = resolvedSrc ? "" : getUserAvatarColor(identifier);
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center text-xs font-semibold select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
        colorClass,
        className,
      )}
      style={
        resolvedSrc
          ? {
              backgroundImage: `url(${resolvedSrc})`,
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {resolvedSrc ? null : avatarInitials(name, username)}
    </span>
  );
}
