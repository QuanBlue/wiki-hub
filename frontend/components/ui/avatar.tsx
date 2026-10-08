import { cn } from "@/lib/utils";

/** "AB" for "Alice Brown"; falls back to the username. */
export function avatarInitials(name: string | null | undefined, username: string): string {
  return ((name ?? "").trim() || username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** A round avatar: the picture when there is one, otherwise initials. */
export function Avatar({
  name,
  username,
  src,
  className,
}: {
  name?: string | null;
  username: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center text-xs font-semibold",
        className,
      )}
      style={src ? { backgroundImage: `url(${src})` } : undefined}
    >
      {src ? null : avatarInitials(name, username)}
    </span>
  );
}
