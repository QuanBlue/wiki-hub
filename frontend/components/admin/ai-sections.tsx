"use client";

import {
  Gauge,
  Globe,
  KeyRound,
  ScanSearch,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { AiConnectionsPanel } from "@/components/admin/ai-connections-panel";
import { AiLimitsPanel } from "@/components/admin/ai-limits-panel";
import { AiSkillsPanel } from "@/components/admin/ai-skills-panel";
import { SemanticSearchPanel } from "@/components/admin/semantic-search-panel";
import { WebSearchPanel } from "@/components/admin/web-search-panel";
import type {
  AiConnectionList,
  AiSkill,
  EmbeddingSettings,
} from "@/lib/admin-ai";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type SectionId = "keys" | "semantic" | "web" | "skills" | "limits";

/** Semantic search is off until an administrator picks a source and a model. */
const NO_EMBEDDING: EmbeddingSettings = {
  source: "provider",
  base_url: "",
  api_key_preview: "",
  has_key: false,
  model: "",
  tuning: {},
  effective: {},
  specs: [],
};

/**
 * Admin > AI assistant in three sections, laid out like Admin > Storage: key
 * management (the providers and their API keys), semantic search (where page text
 * is turned into vectors) and skill management (the instructions the AI follows). Both panels stay mounted and are only hidden,
 * so switching never refetches or loses an edit in progress.
 */
export function AiSections({
  connections,
  embedding = NO_EMBEDDING,
  summarySkill,
  pageDraftSkill,
  explainSkill,
  translateSkill,
  writingSkill,
  suggestionsSkill,
}: {
  connections: AiConnectionList;
  embedding?: EmbeddingSettings;
  summarySkill: AiSkill;
  pageDraftSkill?: AiSkill;
  explainSkill?: AiSkill;
  translateSkill?: AiSkill;
  writingSkill?: AiSkill;
  suggestionsSkill?: AiSkill;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<SectionId>("keys");

  const sections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
    { id: "keys", label: t("adminAi.keysSection"), icon: KeyRound },
    { id: "semantic", label: t("adminAi.semanticSection"), icon: ScanSearch },
    { id: "web", label: t("adminAi.webSection"), icon: Globe },
    { id: "skills", label: t("adminAi.skillsSection"), icon: Sparkles },
    { id: "limits", label: t("adminAi.limitsSection"), icon: Gauge },
  ];

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside
        aria-label={t("adminAi.sectionsLabel")}
        className="border-border border-r pr-5 lg:sticky lg:top-24"
      >
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          {t("adminAi.sectionsLabel")}
        </p>
        <div
          role="tablist"
          aria-orientation="vertical"
          className="mt-3 space-y-1"
        >
          {sections.map(({ id, label, icon: Icon }) => {
            const selected = active === id;
            return (
              <button
                key={id}
                id={`ai-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`ai-panel-${id}`}
                onClick={() => setActive(id)}
                className={cn(
                  "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "bg-surface-selected text-primary hover:bg-surface-hover font-semibold"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground font-normal",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0">
        <div
          id="ai-panel-keys"
          role="tabpanel"
          aria-labelledby="ai-tab-keys"
          hidden={active !== "keys"}
        >
          <AiConnectionsPanel initial={connections} />
        </div>
        <div
          id="ai-panel-semantic"
          role="tabpanel"
          aria-labelledby="ai-tab-semantic"
          hidden={active !== "semantic"}
        >
          <SemanticSearchPanel
            initial={embedding}
            visible={active === "semantic"}
          />
        </div>
        <div
          id="ai-panel-web"
          role="tabpanel"
          aria-labelledby="ai-tab-web"
          hidden={active !== "web"}
        >
          {/* Mounted when first shown: it has nothing to load before then. */}
          {active === "web" ? <WebSearchPanel /> : null}
        </div>
        <div
          id="ai-panel-skills"
          role="tabpanel"
          aria-labelledby="ai-tab-skills"
          hidden={active !== "skills"}
        >
          <AiSkillsPanel
            initialSummary={summarySkill}
            initialPageDraft={pageDraftSkill}
            initialExplain={explainSkill}
            initialTranslate={translateSkill}
            initialWriting={writingSkill}
            initialSuggestions={suggestionsSkill}
          />
        </div>
        <div
          id="ai-panel-limits"
          role="tabpanel"
          aria-labelledby="ai-tab-limits"
          hidden={active !== "limits"}
        >
          {/* Mounted when first shown: it has nothing to load before then. */}
          {active === "limits" ? <AiLimitsPanel /> : null}
        </div>
      </div>
    </div>
  );
}
