import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SpaceList } from "@/components/spaces/space-list";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listFavoriteSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Favorites" };
export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const spaces = await listFavoriteSpaces();

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Favorites</h1>
          <p className="text-muted-foreground mt-1.5">
            Spaces you have starred.
          </p>
        </div>

        <SpaceList
          spaces={spaces}
          emptyTitle="No favourites yet"
          emptyHint="Star a space from the Spaces list to pin it here."
        />
      </div>
    </AppShell>
  );
}
