import { SpaceCard } from "@/components/spaces/space-card";
import type { Space } from "@/types/api";

/** Shared grid + empty state for every list of spaces. */
export function SpaceList({
  spaces,
  emptyTitle,
  emptyHint,
}: {
  spaces: Space[];
  emptyTitle: string;
  emptyHint: string;
}) {
  if (spaces.length === 0) {
    return (
      <div className="border-border bg-surface text-muted-foreground rounded-xl border border-dashed p-10 text-center">
        <p className="text-foreground font-semibold">{emptyTitle}</p>
        <p className="mt-1 text-sm">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {spaces.map((space) => (
        <SpaceCard key={space.id} space={space} />
      ))}
    </div>
  );
}
