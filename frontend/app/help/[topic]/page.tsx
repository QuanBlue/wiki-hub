import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { HelpDetailPage, type HelpCategory } from "@/components/help/help-page";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

const topics: Record<string, HelpCategory> = {
  workspace: "Workspace",
  writing: "Writing",
  attachments: "Attachments & Media",
  account: "Account",
  administration: "Administration",
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  return { title: topics[topic] ? `${topics[topic]} help` : "Help" };
}

export default async function HelpTopicRoute({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const [user, { topic: slug }] = await Promise.all([getCurrentUser(), params]);
  if (!user) redirect("/login");

  const topic = topics[slug];
  if (!topic) notFound();

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <HelpDetailPage topic={topic} />
    </AppShell>
  );
}
