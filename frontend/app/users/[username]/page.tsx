import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { UserProfile } from "@/components/users/user-profile";
import { AppShell } from "@/components/layout/app-shell";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import {
  getPublicUser,
  getUserProfileStats,
  listRecentPages,
  listUserActivity,
  listUserDrafts,
} from "@/lib/pages";

export const metadata: Metadata = { title: "Member profile" };
export const dynamic = "force-dynamic";

/**
 * Personal dashboard panels must never make the member profile unavailable.
 * A newly deployed frontend can briefly run before an optional feature's
 * migration has been applied; profile identity and activity remain useful.
 */
async function optional<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch {
    return fallback;
  }
}

async function loadProfile(username: string, isOwner: boolean, isAdmin: boolean) {
  try {
    const [profile, activity, allActivity, stats, drafts] = await Promise.all([
      getPublicUser(username),
      listUserActivity(username),
      listRecentPages(50),
      getUserProfileStats(username),
      isOwner || isAdmin ? optional(listUserDrafts(username), []) : Promise.resolve([]),
    ]);
    return { profile, activity, allActivity, stats, drafts };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { username } = await params;
  const isAdmin =
    user.is_superuser || user.global_permissions.includes("system_admin");
  const data = await loadProfile(
    username,
    user.username.toLowerCase() === username.toLowerCase(),
    isAdmin,
  );

  return (
    <AppShell siteName={SITE_NAME} user={user} fullWidth>
      <UserProfile
        user={data.profile}
        initialActivity={data.activity}
        initialAllActivity={data.allActivity}
        stats={data.stats}
        drafts={data.drafts}
        isOwner={user.username.toLowerCase() === username.toLowerCase()}
        isAdmin={isAdmin}
      />
    </AppShell>
  );
}
