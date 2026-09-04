import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { UserProfile } from "@/components/users/user-profile";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import {
  getPublicUser,
  getUserProfileStats,
  listRecentPages,
  listUserActivity,
  listUserDrafts,
  listOwnFavoriteSpaces,
  listOwnPinnedPages,
  listOwnLikedPages,
} from "@/lib/pages";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isAdmin = user.is_superuser || user.global_permissions.includes("system_admin");
  const [profile, activity, allActivity, stats, drafts, favoriteSpaces, pinnedPages, likedPages] = await Promise.all([
    getPublicUser(user.username),
    listUserActivity(user.username),
    listRecentPages(50),
    getUserProfileStats(user.username),
    listUserDrafts(user.username).catch(() => []),
    listOwnFavoriteSpaces().catch(() => []),
    listOwnPinnedPages().catch(() => []),
    listOwnLikedPages().catch(() => []),
  ]);

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <UserProfile
        user={profile}
        initialActivity={activity}
        initialAllActivity={allActivity}
        stats={stats}
        drafts={drafts}
        isOwner
        isAdmin={isAdmin}
        favoriteSpaces={favoriteSpaces}
        pinnedPages={pinnedPages}
        likedPages={likedPages}
      />
    </AppShell>
  );
}
