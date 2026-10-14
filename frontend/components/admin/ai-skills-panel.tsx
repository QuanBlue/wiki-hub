"use client";

import {
  BookOpen,
  ChevronRight,
  FilePlus2,
  Loader2,
  Languages,
  PenLine,
  Pencil,
  RotateCcw,
  Sparkles,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import type { AiSkill } from "@/lib/admin-ai";
import { useTranslation } from "@/lib/i18n/context";

const MAX_LENGTH = 4000;

/** The instructions the AI actually follows: the custom ones, else the built-in. */
function effective(skill: AiSkill): string {
  return skill.instructions || skill.default_instructions;
}

type SkillId =
  | "summary"
  | "page-draft"
  | "selection-explain"
  | "selection-translate"
  | "writing"
  | "suggestions";

/** What each card needs to show and save: its URL name, texts and icon. */
const SKILLS: Array<{
  id: SkillId;
  titleKey: string;
  helpKey: string;
  shortKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "summary",
    titleKey: "adminAi.skillSummaryTitle",
    helpKey: "adminAi.skillSummaryHelp",
    shortKey: "adminAi.skillSummaryShort",
    icon: Sparkles,
  },
  {
    id: "page-draft",
    titleKey: "adminAi.skillPageDraftTitle",
    helpKey: "adminAi.skillPageDraftHelp",
    shortKey: "adminAi.skillPageDraftShort",
    icon: FilePlus2,
  },
  {
    id: "selection-explain",
    titleKey: "adminAi.skillExplainTitle",
    helpKey: "adminAi.skillExplainHelp",
    shortKey: "adminAi.skillExplainShort",
    icon: BookOpen,
  },
  {
    id: "selection-translate",
    titleKey: "adminAi.skillTranslateTitle",
    helpKey: "adminAi.skillTranslateHelp",
    shortKey: "adminAi.skillTranslateShort",
    icon: Languages,
  },
  {
    id: "writing",
    titleKey: "adminAi.skillWritingTitle",
    helpKey: "adminAi.skillWritingHelp",
    shortKey: "adminAi.skillWritingShort",
    icon: PenLine,
  },
  {
    id: "suggestions",
    titleKey: "adminAi.skillSuggestTitle",
    helpKey: "adminAi.skillSuggestHelp",
    shortKey: "adminAi.skillSuggestShort",
    icon: Tags,
  },
];

type Open = { id: SkillId; mode: "view" | "edit" } | null;

/**
 * Skills, as cards: the instructions behind an AI feature - the page summary
 * and drafting a new page. A card shows what the skill currently says and
 * whether it is the built-in wording or custom; View reads it in full, Edit
 * changes it.
 */
export function AiSkillsPanel({
  initialSummary,
  initialPageDraft,
  initialExplain,
  initialTranslate,
  initialWriting,
  initialSuggestions,
}: {
  initialSummary: AiSkill;
  initialPageDraft?: AiSkill;
  initialExplain?: AiSkill;
  initialTranslate?: AiSkill;
  initialWriting?: AiSkill;
  initialSuggestions?: AiSkill;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Partial<Record<SkillId, AiSkill>>>({
    summary: initialSummary,
    "page-draft": initialPageDraft,
    "selection-explain": initialExplain,
    "selection-translate": initialTranslate,
    writing: initialWriting,
    suggestions: initialSuggestions,
  });
  const [open, setOpen] = useState<Open>(null);
  const shown = SKILLS.filter((def) => skills[def.id]);
  const current = open ? SKILLS.find((def) => def.id === open.id) : undefined;

  return (
    <section aria-labelledby="ai-skills-heading" className="space-y-4">
      <div>
        <h3 id="ai-skills-heading" className="text-base font-semibold">
          {t("adminAi.skillsHeading")}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("adminAi.skillsDescription")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((def) => {
          const skill = skills[def.id] as AiSkill;
          const Icon = def.icon;
          return (
            <article key={def.id} aria-labelledby={`ai-skill-${def.id}-title`}>
              <button
                type="button"
                onClick={() => setOpen({ id: def.id, mode: "view" })}
                className="border-border bg-surface hover:bg-surface-hover hover:border-primary/40 focus-visible:ring-ring flex h-full w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="bg-primary-subtle text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      id={`ai-skill-${def.id}-title`}
                      className="text-sm font-semibold"
                    >
                      {t(def.titleKey)}
                    </span>
                    <Badge variant={skill.is_custom ? "info" : "neutral"}>
                      {skill.is_custom
                        ? t("adminAi.skillCustomBadge")
                        : t("adminAi.skillDefaultBadge")}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {t(def.shortKey)}
                  </span>
                </span>
                <ChevronRight
                  className="text-muted-foreground mt-2 size-4 shrink-0"
                  aria-hidden
                />
              </button>
            </article>
          );
        })}
      </div>

      {current && open ? (
        <SkillDialog
          def={current}
          mode={open.mode}
          skill={skills[current.id] as AiSkill}
          onModeChange={(mode) =>
            setOpen(mode ? { id: current.id, mode } : null)
          }
          onSaved={(next) =>
            setSkills((all) => ({ ...all, [current.id]: next }))
          }
        />
      ) : null}
    </section>
  );
}

function SkillDialog({
  def,
  mode,
  skill,
  onModeChange,
  onSaved,
}: {
  def: (typeof SKILLS)[number];
  mode: "view" | "edit";
  skill: AiSkill;
  onModeChange: (mode: "view" | "edit" | null) => void;
  onSaved: (skill: AiSkill) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onModeChange(null)}>
      <DialogContent
        className="max-w-2xl"
        title={t(def.titleKey)}
        description={t(def.helpKey)}
      >
        {/* Mounted only while open, so each opening starts from what is saved. */}
        {mode === "edit" ? (
          <EditBody
            id={def.id}
            skill={skill}
            onSaved={onSaved}
            onDone={() => onModeChange(null)}
          />
        ) : (
          <ViewBody
            skill={skill}
            onEdit={() => onModeChange("edit")}
            onClose={() => onModeChange(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewBody({
  skill,
  onEdit,
  onClose,
}: {
  skill: AiSkill;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {t("adminAi.skillInstructions")}
          </span>
          <Badge variant={skill.is_custom ? "info" : "neutral"}>
            {skill.is_custom
              ? t("adminAi.skillCustomBadge")
              : t("adminAi.skillDefaultBadge")}
          </Badge>
        </div>
        <div
          tabIndex={0}
          aria-label={t("adminAi.skillInstructions")}
          className="bg-surface-sunken border-border focus-visible:ring-ring wh-scroll max-h-72 overflow-y-auto rounded-md border px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none"
        >
          {effective(skill)}
        </div>
        <p className="text-muted-foreground text-xs">
          {t("adminAi.skillFixedRules")}
        </p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("adminAi.skillClose")}
        </Button>
        <Button variant="primary" onClick={onEdit}>
          <Pencil aria-hidden />
          {t("adminAi.skillEdit")}
        </Button>
      </DialogFooter>
    </>
  );
}

function EditBody({
  id,
  skill,
  onSaved,
  onDone,
}: {
  id: SkillId;
  skill: AiSkill;
  onSaved: (skill: AiSkill) => void;
  onDone: () => void;
}) {
  const { t, apiErrorText } = useTranslation();
  // Start from what the AI follows today, so the built-in wording can be tweaked
  // rather than rewritten from nothing.
  const [text, setText] = useState(effective(skill));
  const [pending, setPending] = useState<"save" | "reset" | null>(null);

  const dirty = text.trim() !== effective(skill).trim();

  async function persist(instructions: string, kind: "save" | "reset") {
    setPending(kind);
    try {
      // Saving the built-in wording unchanged is the same as using the default.
      const sendable =
        instructions.trim() === skill.default_instructions.trim()
          ? ""
          : instructions;
      const next = await api.put<AiSkill>(`/api/v1/ai/skills/${id}`, {
        instructions: sendable,
      });
      onSaved(next);
      toast.success(
        t(kind === "reset" ? "adminAi.skillResetDone" : "adminAi.skillSaved"),
      );
      onDone();
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.skillSaveError"));
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void persist(text, "save");
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`ai-skill-${id}`}>
          {t("adminAi.skillInstructions")}
        </Label>
        <Textarea
          id={`ai-skill-${id}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_LENGTH}
          rows={9}
        />
        <div className="text-muted-foreground flex flex-wrap items-start justify-between gap-2 text-xs">
          <span>{t("adminAi.skillFixedRules")}</span>
          <span className="tabular-nums">
            {t("adminAi.skillCount", { count: text.length })}
          </span>
        </div>
      </div>
      <DialogFooter className="items-center">
        <Button
          type="button"
          variant="ghost"
          className="mr-auto"
          disabled={!skill.is_custom || pending !== null}
          onClick={() => void persist(skill.default_instructions, "reset")}
        >
          {pending === "reset" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          {t("adminAi.skillUseDefault")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!dirty || !text.trim() || pending !== null}
        >
          {pending === "save" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          {pending === "save"
            ? t("adminAi.skillSaving")
            : t("adminAi.skillSave")}
        </Button>
      </DialogFooter>
    </form>
  );
}
