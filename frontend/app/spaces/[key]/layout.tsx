import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { spaceTabTitle } from "@/lib/space-tab-title";
import { getSpace } from "@/lib/spaces";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  try {
    const space = await getSpace(key);
    return { title: spaceTabTitle(space.name, key) };
  } catch {
    return { title: key.toUpperCase() };
  }
}

export default async function SpaceRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      siteName={SITE_NAME}
      user={user}
      hideSidebar
      contentClassName="max-w-none px-0 py-0 sm:px-0 sm:py-0"
    >
      {children}
    </AppShell>
  );
}
