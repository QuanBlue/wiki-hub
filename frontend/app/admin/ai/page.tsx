import type { Metadata } from "next";

import { AiSections } from "@/components/admin/ai-sections";
import {
  getAiConnections,
  getEmbeddingSettings,
  getAiPageDraftSkill,
  getAiSkill,
  getAiSummarySkill,
} from "@/lib/admin-ai";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "AI assistant" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // Only `system_admin` may change where page text is sent.
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">
          {t("adminShared.permissionRequiredTitle")}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminAi.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  const [
    connections,
    embedding,
    summarySkill,
    pageDraftSkill,
    explainSkill,
    translateSkill,
    writingSkill,
    suggestionsSkill,
  ] = await Promise.all([
    getAiConnections(),
    getEmbeddingSettings(),
    getAiSummarySkill(),
    getAiPageDraftSkill(),
    getAiSkill("selection-explain"),
    getAiSkill("selection-translate"),
    getAiSkill("writing"),
    getAiSkill("suggestions"),
  ]);

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminAi.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminAi.description")}
        </p>
      </header>
      <AiSections
        connections={connections}
        embedding={embedding}
        summarySkill={summarySkill}
        pageDraftSkill={pageDraftSkill}
        explainSkill={explainSkill}
        translateSkill={translateSkill}
        writingSkill={writingSkill}
        suggestionsSkill={suggestionsSkill}
      />
    </div>
  );
}
