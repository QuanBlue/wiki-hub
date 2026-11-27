"use client";

import {
  CheckCircle2,
  FilePlus2,
  FileText,
  Info,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AiClarifyQuestions } from "@/components/pages/ai-clarify-questions";
import { AiNotSetUp } from "@/components/pages/ai-not-set-up";
import { TemplateIcon } from "@/components/templates/template-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  aiStatus,
  clarifyPage,
  draftPage,
  type ClarifyMode,
  type ClarifyQuestion,
  type PageAnswer,
  type PageClarify,
  type PageDetailLevel,
} from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { markdownToHtml } from "@/lib/markdown-html";
import { listSpaceTemplates } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { PageTemplate, PageTemplateScope, WikiPage } from "@/types/api";

const AI_SUGGESTIONS = ["runbook", "meeting", "howto", "brief"] as const;

// Only loaded once there is a draft to show: the editor is heavy.
const DraftPreview = dynamic(
  () =>
    import("@/components/pages/rich-text-editor").then(
      (mod) => mod.RichTextContent,
    ),
  { ssr: false },
);

export function CreatePageDialog({
  spaceKey,
  parentPage,
  triggerLabel = "Create page",
  triggerTitle,
  triggerVariant = "primary",
  triggerSize = "md",
}: {
  spaceKey: string;
  parentPage?: Pick<WikiPage, "id" | "title"> | null;
  triggerLabel?: string;
  triggerTitle?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
}) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  // "Write with AI": hidden unless the assistant is on. A draft replaces the
  // plain content box and is only saved when the page is created.
  const [aiOn, setAiOn] = useState(false);
  // Whether the assistant's availability is known yet. Once it is, the tabs show
  // either way; "Write with AI" is simply switched off until it is set up.
  const [aiKnown, setAiKnown] = useState(false);
  const [canConfigure, setCanConfigure] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [mode, setMode] = useState<"write" | "ai">("write");
  const [aiPrompt, setAiPrompt] = useState("");
  const [clarifyMode, setClarifyMode] = useState<ClarifyMode>("deep");
  const [detailLevel, setDetailLevel] = useState<PageDetailLevel>("detailed");
  const [aiBusy, setAiBusy] = useState(false);
  const [clarifyThinking, setClarifyThinking] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [clarify, setClarify] = useState<PageClarify | null>(null);
  const [answers, setAnswers] = useState<PageAnswer[]>([]);
  const [clarifyHistory, setClarifyHistory] = useState<
    Array<{ question: ClarifyQuestion; answer: PageAnswer }>
  >([]);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateScope, setTemplateScope] = useState<"all" | PageTemplateScope>(
    "all",
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    void aiStatus().then((status) => {
      if (!active) return;
      setAiOn(Boolean(status?.enabled));
      setCanConfigure(Boolean(status?.can_configure));
      setAiKnown(true);
    });
    void listSpaceTemplates(spaceKey, locale)
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch(() => {
        if (active) setTemplates([]);
      });
    return () => {
      active = false;
    };
  }, [locale, open, spaceKey]);

  const selectedTemplate = useMemo(
    () =>
      selectedTemplateId
        ? (templates.find((item) => item.id === selectedTemplateId) ?? null)
        : null,
    [selectedTemplateId, templates],
  );

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return templates.filter((item) => {
      if (templateScope !== "all" && item.scope !== templateScope) return false;
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      );
    });
  }, [templateScope, templateSearch, templates]);

  // The AI first looks the request up in the wiki and interviews the author
  // branch-by-branch in Deep mode; settled answers are kept separately from
  // the raw description so nothing is truncated and Regenerate reuses them.
  async function writeDraft(
    prompt: string,
    context: { answers: PageAnswer[]; related: PageClarify["related"] },
  ) {
    setAiBusy(true);
    try {
      const result = await draftPage(spaceKey, {
        prompt,
        title: title.trim(),
        lang: locale,
        answers: context.answers,
        related_ids: context.related.map((page) => page.id),
        detail: detailLevel,
      });
      setDraft(result.content);
      setDraftMarkdown(result.markdown ?? "");
      if (!title.trim()) setTitle(result.title);
    } catch (error) {
      setAiError(aiErrorText(error));
    } finally {
      setAiBusy(false);
    }
  }

  // Say what went wrong where the author is looking, not just in a toast: a
  // bare "Not Found" from an out-of-date server means nothing to them.
  function aiErrorText(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 404 || error.status === 405)
        return t("pageCreate.aiUnavailable");
      if (error.message) return error.message;
    }
    return t("pageCreate.aiError");
  }

  async function generate(text = aiPrompt, fresh = false) {
    const prompt = text.trim();
    if (prompt.length < 3 || aiBusy || clarifyThinking || refining) return;
    setAiError(null);

    if (clarifyMode === "quick") {
      setAsking(false);
      await writeDraft(prompt, {
        answers: fresh ? [] : answers,
        related: fresh ? [] : (clarify?.related ?? []),
      });
      return;
    }

    const known = fresh ? null : clarify;
    if (known && (draft !== null || known.done)) {
      await writeDraft(prompt, { answers, related: known.related });
      return;
    }

    setAiBusy(true);
    if (fresh) {
      setAnswers([]);
      setClarifyHistory([]);
    }
    try {
      const nextAnswers = fresh ? [] : answers;
      const found = await clarifyPage(spaceKey, {
        prompt,
        title: title.trim(),
        lang: locale,
        mode: "deep",
        answers: nextAnswers,
        related_ids: fresh ? [] : (clarify?.related.map((p) => p.id) ?? []),
      });
      setClarify(found);
      if (!found.done && found.questions.length > 0) {
        setAsking(true);
        setAiBusy(false);
        return;
      }
      setAiBusy(false);
      await writeDraft(prompt, {
        answers: nextAnswers,
        related: found.related,
      });
    } catch (error) {
      setAiError(aiErrorText(error));
      setAiBusy(false);
    }
  }

  async function continueGrilling() {
    const prompt = aiPrompt.trim();
    if (prompt.length < 3 || aiBusy || clarifyThinking) return;
    setAiError(null);
    setAiBusy(true);
    try {
      const found = await clarifyPage(spaceKey, {
        prompt,
        title: title.trim(),
        lang: locale,
        mode: "deep",
        answers,
        related_ids: (clarify?.related ?? []).map((p) => p.id),
      });
      setClarify(found);
      if (!found.done && found.questions.length > 0) {
        setAsking(true);
      } else {
        await writeDraft(prompt, {
          answers,
          related: found.related,
        });
      }
    } catch (error) {
      setAiError(aiErrorText(error));
    } finally {
      setAiBusy(false);
    }
  }

  async function handleDeepAnswer(answer: PageAnswer) {
    const currentQuestion = clarify?.questions[0];
    const nextAnswers = [...answers, answer];
    const nextHistory = [
      ...clarifyHistory,
      ...(currentQuestion ? [{ question: currentQuestion, answer }] : []),
    ];

    setAiError(null);
    setClarifyThinking(true);
    try {
      const next = await clarifyPage(spaceKey, {
        prompt: aiPrompt.trim(),
        title: title.trim(),
        lang: locale,
        mode: "deep",
        answers: nextAnswers,
        related_ids: (clarify?.related ?? []).map((p) => p.id),
      });
      setAnswers(nextAnswers);
      setClarifyHistory(nextHistory);
      setClarifyThinking(false);
      setClarify(next);
      const maxQ = next.max_questions ?? 10;
      if (
        next.done ||
        next.questions.length === 0 ||
        nextAnswers.length >= maxQ
      ) {
        setAsking(false);
        await writeDraft(aiPrompt.trim(), {
          answers: nextAnswers,
          related: next.related,
        });
      }
    } catch (error) {
      setClarifyThinking(false);
      setAiError(aiErrorText(error));
    }
  }

  function handleDeepBack() {
    setAiError(null);
    if (clarifyHistory.length === 0) {
      setAsking(false);
      return;
    }
    const last = clarifyHistory[clarifyHistory.length - 1];
    setClarifyHistory((prev) => prev.slice(0, -1));
    setAnswers((prev) => prev.slice(0, -1));
    if (clarify) {
      setClarify({
        ...clarify,
        done: false,
        questions: [last.question],
      });
    }
  }

  function handleRewindTo(index: number) {
    const target = clarifyHistory[index];
    if (!target || !clarify || aiBusy || clarifyThinking) return;
    setAiError(null);
    setClarifyHistory((prev) => prev.slice(0, index));
    setAnswers((prev) => prev.slice(0, index));
    setClarify({
      ...clarify,
      done: false,
      questions: [target.question],
    });
    setAsking(true);
  }

  async function handleWriteNow(currentAnswer?: PageAnswer) {
    setAiError(null);
    const currentQuestion = clarify?.questions[0];
    const nextAnswers = currentAnswer ? [...answers, currentAnswer] : answers;
    const nextHistory = [
      ...clarifyHistory,
      ...(currentAnswer && currentQuestion
        ? [{ question: currentQuestion, answer: currentAnswer }]
        : []),
    ];
    setAnswers(nextAnswers);
    setClarifyHistory(nextHistory);
    setAsking(false);
    await writeDraft(aiPrompt.trim(), {
      answers: nextAnswers,
      related: clarify?.related ?? [],
    });
  }

  async function handleRefine() {
    const instruction = refineInput.trim();
    if (instruction.length < 2 || !draft || aiBusy || refining) return;
    setAiError(null);
    setRefining(true);
    try {
      const result = await draftPage(spaceKey, {
        prompt: aiPrompt.trim(),
        title: title.trim(),
        lang: locale,
        answers,
        related_ids: (clarify?.related ?? []).map((p) => p.id),
        detail: detailLevel,
        previous_draft: draftMarkdown || draft,
        revision_instruction: instruction,
      });
      setDraft(result.content);
      setDraftMarkdown(result.markdown ?? "");
      if (!title.trim() && result.title) setTitle(result.title);
      setRefineInput("");
    } catch (error) {
      setAiError(aiErrorText(error));
    } finally {
      setRefining(false);
    }
  }

  function changePrompt(value: string) {
    setAiError(null);
    setAiPrompt(value);
    // A new description needs its own look-up and questions.
    setClarify(null);
    setAnswers([]);
    setClarifyHistory([]);
    setAsking(false);
  }

  // From the Write tab: whatever was typed (or, failing that, the title) is the
  // description, and the draft starts straight away instead of an empty form.
  function draftFromWritten() {
    const seed = content.trim() || title.trim();
    setMode("ai");
    if (seed.length < 3) return;
    const clipped = seed.slice(0, 8000);
    changePrompt(clipped);
    void generate(clipped, true);
  }

  function discardDraft() {
    setDraft(null);
    setDraftMarkdown("");
    setRefineInput("");
  }

  function clearDecisions() {
    setAnswers([]);
    setClarifyHistory([]);
    setClarify(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setPending(true);
    try {
      const useTemplate =
        (mode === "write" || !aiOn) && draft === null && selectedTemplate !== null;
      const payload: Record<string, unknown> = {
        title: trimmedTitle,
        content: useTemplate ? "" : (draft ?? content),
        parent_id: parentPage?.id ?? null,
      };
      if (useTemplate && selectedTemplate) {
        payload.template_id = selectedTemplate.id;
        payload.template_lang = locale;
      }
      const page = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages`,
        payload,
      );
      toast.success(t("pageCreate.createdToast", { title: page.title }));
      setOpen(false);
      setTitle("");
      setContent("");
      setDraft(null);
      setDraftMarkdown("");
      setRefineInput("");
      setClarify(null);
      setAnswers([]);
      setClarifyHistory([]);
      setAsking(false);
      setMode("write");
      setAiPrompt("");
      setSelectedTemplateId(null);
      setTemplateSearch("");
      setTemplateScope("all");
      router.push(
        `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("pageCreate.createError"),
      );
      setPending(false);
    }
  }

  // Before there is a draft, the right-hand side lists either the live
  // interview decisions (while grilling) or the wiki pages found for the
  // request.
  const showRelated =
    draft === null && !aiBusy && clarify !== null && clarify.related.length > 0;
  const rightLabel =
    asking && clarify
      ? t("pageCreate.aiDecisionsTitle")
      : showRelated
        ? t("pageCreate.aiRelatedTitle")
        : t("pageCreate.aiPreviewLabel");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          aria-label={triggerLabel || t("pageCreate.newPageAria")}
          title={triggerTitle || triggerLabel || t("pageCreate.newPageAria")}
        >
          <FilePlus2 />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={
          mode === "ai" && aiOn
            ? "max-w-5xl"
            : aiKnown || templates.length > 0
              ? "max-w-4xl"
              : undefined
        }
        title={
          parentPage
            ? t("pageCreate.createChildTitle")
            : t("pageCreate.createTitle")
        }
        description={
          parentPage
            ? t("pageCreate.createChildDescription", {
                title: parentPage.title,
              })
            : t("pageCreate.createTopLevelDescription")
        }
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="page-title">{t("pageCreate.titleLabel")}</Label>
            <input
              id="page-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClassName}
              placeholder={t("pageCreate.titlePlaceholder")}
              autoFocus
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-3">
            {aiKnown ? (
              <div className="border-border flex gap-1 border-b">
                {(["write", "ai"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    disabled={aiBusy && mode !== value}
                    onClick={() => setMode(value)}
                    className={cn(
                      "focus-visible:ring-ring -mb-px flex cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                      mode === value
                        ? "border-primary text-primary"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground border-transparent",
                    )}
                  >
                    {value === "ai" ? (
                      <Sparkles className="size-4" aria-hidden />
                    ) : null}
                    {value === "ai"
                      ? t("pageCreate.aiWrite")
                      : t("pageCreate.writeManually")}
                  </button>
                ))}
              </div>
            ) : null}

            {mode === "ai" && aiKnown && !aiOn ? (
              // Not connected yet: say so here, as the TL;DR dialog does.
              <div className="flex items-center justify-center md:h-[22rem] md:overflow-y-auto">
                <AiNotSetUp canConfigure={canConfigure} layout="split" />
              </div>
            ) : mode === "write" || !aiOn ? (
              <div
                className={cn(
                  "flex flex-col gap-3",
                  aiKnown && templates.length === 0 && "md:h-[22rem]",
                )}
              >
                {templates.length > 0 ? (
                  <div className="grid gap-4 md:h-[22rem] md:grid-cols-[17rem_1fr]">
                    <div className="flex min-h-0 flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                          <LayoutTemplate className="size-3.5" aria-hidden />
                          {t("templates.pickerLabel")}
                        </span>
                      </div>

                      <div className="relative">
                        <Search
                          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                          aria-hidden
                        />
                        <input
                          type="search"
                          value={templateSearch}
                          onChange={(event) =>
                            setTemplateSearch(event.target.value)
                          }
                          placeholder={t("templates.searchPlaceholder")}
                          aria-label={t("templates.searchPlaceholder")}
                          className={cn(inputClassName, "h-8 pl-8 text-xs")}
                        />
                      </div>

                      <div
                        role="group"
                        aria-label={t("templates.scopeLabel")}
                        className="flex flex-wrap gap-1"
                      >
                        {(["all", "space", "global", "builtin"] as const).map(
                          (scope) => (
                            <button
                              key={scope}
                              type="button"
                              aria-pressed={templateScope === scope}
                              onClick={() => setTemplateScope(scope)}
                              className={cn(
                                "focus-visible:ring-ring cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                                templateScope === scope
                                  ? "border-primary bg-primary-subtle text-primary"
                                  : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                              )}
                            >
                              {scope === "all"
                                ? t("templates.scopeAll")
                                : scope === "space"
                                  ? t("templates.scopeSpace")
                                  : scope === "global"
                                    ? t("templates.scopeGlobal")
                                    : t("templates.scopeBuiltin")}
                            </button>
                          ),
                        )}
                      </div>

                      <div
                        role="radiogroup"
                        aria-label={t("templates.pickerLabel")}
                        className="border-border bg-surface-sunken wh-scroll min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border p-1.5"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selectedTemplate === null}
                          onClick={() => setSelectedTemplateId(null)}
                          className={cn(
                            "focus-visible:ring-ring flex w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                            selectedTemplate === null
                              ? "border-primary bg-surface text-foreground shadow-xs"
                              : "hover:bg-surface-hover active:bg-surface-selected border-transparent text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <FileText
                            className="text-muted-foreground mt-0.5 size-4 shrink-0"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-xs font-medium">
                              {t("templates.blankPage")}
                            </span>
                            <span className="text-muted-foreground block truncate text-[11px]">
                              {t("templates.blankPageDescription")}
                            </span>
                          </span>
                        </button>

                        {filteredTemplates.map((tpl) => {
                          const isSelected = selectedTemplate?.id === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() => setSelectedTemplateId(tpl.id)}
                              className={cn(
                                "focus-visible:ring-ring flex w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                                isSelected
                                  ? "border-primary bg-surface text-foreground shadow-xs"
                                  : "hover:bg-surface-hover active:bg-surface-selected border-transparent text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <span
                                className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-sm leading-none"
                                aria-hidden
                              >
                                <TemplateIcon icon={tpl.icon} className="size-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-1">
                                  <span className="text-foreground truncate text-xs font-medium">
                                    {tpl.name}
                                  </span>
                                  <Badge
                                    variant={
                                      tpl.scope === "space"
                                        ? "info"
                                        : tpl.scope === "global"
                                          ? "success"
                                          : "neutral"
                                    }
                                    className="px-1 py-0 text-[10px]"
                                  >
                                    {tpl.scope === "space"
                                      ? t("templates.scopeSpace")
                                      : tpl.scope === "global"
                                        ? t("templates.scopeGlobal")
                                        : t("templates.scopeBuiltin")}
                                  </Badge>
                                </span>
                                {tpl.description ? (
                                  <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                                    {tpl.description}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col gap-2">
                      {selectedTemplate ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-foreground truncate text-sm font-medium">
                                {selectedTemplate.name}
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-xs"
                              onClick={() => setSelectedTemplateId(null)}
                            >
                              <X aria-hidden />
                              {t("templates.useBlankPage")}
                            </Button>
                          </div>
                          <div
                            role="region"
                            aria-label={t("templates.previewTitle")}
                            className="border-border bg-surface wh-scroll min-h-40 flex-1 overflow-y-auto rounded-md border px-4 py-3"
                          >
                            {selectedTemplate.content.trim() ? (
                              <DraftPreview
                                content={
                                  selectedTemplate.content_format === "markdown"
                                    ? markdownToHtml(selectedTemplate.content)
                                    : selectedTemplate.content
                                }
                              />
                            ) : (
                              <p className="text-muted-foreground text-xs">
                                {t("templates.previewEmpty")}
                              </p>
                            )}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {t("templates.selectedNotice", {
                              name: selectedTemplate.name,
                            })}
                          </p>
                        </>
                      ) : (
                        <>
                          {aiKnown ? null : (
                            <Label htmlFor="page-content">
                              {t("pageCreate.contentLabel")}
                            </Label>
                          )}
                          <textarea
                            id="page-content"
                            aria-label={
                              aiKnown ? t("pageCreate.contentLabel") : undefined
                            }
                            value={content}
                            onChange={(event) => setContent(event.target.value)}
                            className={cn(
                              inputClassName,
                              "min-h-40 flex-1 resize-none py-2 leading-6",
                            )}
                            placeholder={t("pageCreate.contentPlaceholder")}
                            maxLength={200000}
                          />
                          {aiOn ? (
                            <div className="bg-surface-sunken flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-3 py-2">
                              <p className="text-muted-foreground flex min-w-0 flex-1 items-start gap-2 text-xs">
                                <Info
                                  className="mt-0.5 size-3.5 shrink-0"
                                  aria-hidden
                                />
                                {t("pageCreate.writeHint")}
                              </p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={draftFromWritten}
                              >
                                <Sparkles aria-hidden />
                                {t("pageCreate.writeSwitchAi")}
                              </Button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {aiKnown ? null : (
                      <Label htmlFor="page-content">
                        {t("pageCreate.contentLabel")}
                      </Label>
                    )}
                    <textarea
                      id="page-content"
                      aria-label={
                        aiKnown ? t("pageCreate.contentLabel") : undefined
                      }
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      className={cn(
                        inputClassName,
                        "min-h-40 flex-1 py-2 leading-6",
                        aiKnown ? "resize-none" : "resize-y",
                      )}
                      placeholder={t("pageCreate.contentPlaceholder")}
                      maxLength={200000}
                    />
                    {aiOn ? (
                      <div className="bg-surface-sunken flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-3 py-2">
                        <p className="text-muted-foreground flex min-w-0 flex-1 items-start gap-2 text-xs">
                          <Info
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                          {t("pageCreate.writeHint")}
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={draftFromWritten}
                        >
                          <Sparkles aria-hidden />
                          {t("pageCreate.writeSwitchAi")}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-5 md:h-[32rem] md:max-h-[70vh] md:grid-cols-2">
                {asking && clarify && clarify.questions.length > 0 ? (
                  <div className="flex min-h-0 flex-col gap-2">
                    <div className="flex h-7 items-center">
                      <span className="text-sm leading-none font-medium">
                        {t("pageCreate.aiQuestionsTitle")}
                      </span>
                    </div>
                    {aiError ? (
                      <p
                        role="alert"
                        className="border-danger/40 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                      >
                        <TriangleAlert
                          className="mt-0.5 size-3.5 shrink-0"
                          aria-hidden
                        />
                        {aiError}
                      </p>
                    ) : null}
                    <AiClarifyQuestions
                      key={
                        clarifyMode === "deep"
                          ? `${clarifyHistory.length}-${clarify.questions[0]?.question ?? ""}`
                          : "batch"
                      }
                      questions={clarify.questions}
                      busy={aiBusy}
                      adaptive={clarifyMode === "deep"}
                      questionNumber={clarifyHistory.length + 1}
                      maxQuestions={clarify.max_questions ?? 10}
                      canGoBack={true}
                      thinking={clarifyThinking}
                      onAnswer={(ans) => void handleDeepAnswer(ans)}
                      onBack={handleDeepBack}
                      onWriteNow={(ans) => void handleWriteNow(ans)}
                      onSubmit={() => void handleWriteNow()}
                      onSkip={() => void handleWriteNow()}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-col gap-2.5">
                    <div className="flex h-7 items-center justify-between gap-2">
                      <Label htmlFor="page-ai-prompt">
                        {t("pageCreate.aiPromptLabel")}
                      </Label>
                    </div>

                    <div className="flex flex-wrap items-stretch gap-2">
                      <div className="border-border bg-surface-sunken/70 flex min-w-[12rem] flex-1 flex-col gap-1.5 rounded-lg border p-2">
                        <span className="text-foreground flex items-center gap-1.5 text-[11px] font-semibold">
                          <MessageSquareText
                            className="text-muted-foreground size-3.5 shrink-0"
                            aria-hidden
                          />
                          {t("pageCreate.aiModeLabel")}
                        </span>
                        <div
                          role="group"
                          aria-label={t("pageCreate.aiModeLabel")}
                          className="border-border bg-surface flex gap-0.5 rounded-md border p-0.5"
                        >
                          {(["deep", "quick"] as const).map((val) => (
                            <button
                              key={val}
                              type="button"
                              aria-pressed={clarifyMode === val}
                              title={t(
                                val === "deep"
                                  ? "pageCreate.aiModeDeepHint"
                                  : "pageCreate.aiModeQuickHint",
                              )}
                              disabled={aiBusy || refining}
                              onClick={() => setClarifyMode(val)}
                              className={cn(
                                "focus-visible:ring-ring flex-1 cursor-pointer rounded px-2 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                                clarifyMode === val
                                  ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-xs active:opacity-95"
                                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                              )}
                            >
                              {t(
                                val === "deep"
                                  ? "pageCreate.aiModeDeep"
                                  : "pageCreate.aiModeQuick",
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="border-border bg-surface-sunken/70 flex min-w-[13rem] flex-1 flex-col gap-1.5 rounded-lg border p-2">
                        <span className="text-foreground flex items-center gap-1.5 text-[11px] font-semibold">
                          <SlidersHorizontal
                            className="text-muted-foreground size-3.5 shrink-0"
                            aria-hidden
                          />
                          {t("pageCreate.aiDetailLabel")}
                        </span>
                        <div
                          role="group"
                          aria-label={t("pageCreate.aiDetailLabel")}
                          className="border-border bg-surface flex gap-0.5 rounded-md border p-0.5"
                        >
                          {(["brief", "normal", "detailed"] as const).map(
                            (lvl) => (
                              <button
                                key={lvl}
                                type="button"
                                aria-pressed={detailLevel === lvl}
                                disabled={aiBusy || refining}
                                onClick={() => setDetailLevel(lvl)}
                                className={cn(
                                  "focus-visible:ring-ring flex-1 cursor-pointer rounded px-2 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                                  detailLevel === lvl
                                    ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-xs active:opacity-95"
                                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                                )}
                              >
                                {t(
                                  lvl === "brief"
                                    ? "pageCreate.aiDetailBrief"
                                    : lvl === "normal"
                                      ? "pageCreate.aiDetailNormal"
                                      : "pageCreate.aiDetailDetailed",
                                )}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    </div>

                    <textarea
                      id="page-ai-prompt"
                      value={aiPrompt}
                      onChange={(event) => changePrompt(event.target.value)}
                      className={cn(
                        inputClassName,
                        "min-h-28 flex-1 resize-none py-2 leading-6",
                      )}
                      placeholder={t("pageCreate.aiPromptPlaceholder")}
                      maxLength={8000}
                      disabled={aiBusy || refining}
                    />

                    {answers.length > 0 ? (
                      <div className="border-border bg-surface-sunken flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                        <span className="text-foreground flex items-center gap-1.5 font-medium">
                          <CheckCircle2
                            className="text-success size-3.5 shrink-0"
                            aria-hidden
                          />
                          {t("pageCreate.aiDecisionsCount", {
                            count: answers.length,
                          })}
                        </span>
                        <div className="flex items-center gap-1">
                          {clarifyMode === "deep" &&
                          answers.length < (clarify?.max_questions ?? 10) ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              disabled={aiBusy || refining}
                              onClick={() => void continueGrilling()}
                            >
                              {t("pageCreate.aiContinueGrill")}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground h-6 px-2 text-xs"
                            disabled={aiBusy || refining}
                            onClick={clearDecisions}
                          >
                            {t("pageCreate.aiClearDecisions")}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div
                      role="group"
                      aria-label={t("pageCreate.aiSuggestLabel")}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="text-muted-foreground text-xs">
                        {t("pageCreate.aiSuggestLabel")}
                      </span>
                      {AI_SUGGESTIONS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          disabled={aiBusy || refining}
                          onClick={() => {
                            changePrompt(
                              t(`pageCreate.aiSuggest.${key}.prompt`),
                            );
                            document.getElementById("page-ai-prompt")?.focus();
                          }}
                          className="border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t(`pageCreate.aiSuggest.${key}.label`)}
                        </button>
                      ))}
                    </div>
                    {aiError ? (
                      <p
                        role="alert"
                        className="border-danger/40 bg-danger-bg text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                      >
                        <TriangleAlert
                          className="mt-0.5 size-3.5 shrink-0"
                          aria-hidden
                        />
                        {aiError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      disabled={
                        aiBusy || refining || aiPrompt.trim().length < 3
                      }
                      onClick={() => void generate()}
                    >
                      {aiBusy ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : draft === null ? (
                        <Sparkles aria-hidden />
                      ) : (
                        <RefreshCw aria-hidden />
                      )}
                      {aiBusy
                        ? t("pageCreate.aiGenerating")
                        : draft === null
                          ? t("pageCreate.aiGenerate")
                          : t("pageCreate.aiRegenerate")}
                    </Button>
                  </div>
                )}

                <div className="flex min-h-0 flex-col gap-2">
                  <div className="flex h-7 items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm leading-none font-medium">
                      {rightLabel}
                      {asking && clarifyHistory.length > 0 ? (
                        <Badge variant="info" className="px-1.5 py-0 text-[10px]">
                          {t("pageCreate.aiDecisionsCount", {
                            count: clarifyHistory.length,
                          })}
                        </Badge>
                      ) : null}
                    </span>
                    {draft !== null && !asking ? (
                      <div className="-mr-1.5 flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-7 px-2"
                          disabled={aiBusy || refining}
                          onClick={discardDraft}
                        >
                          <X aria-hidden />
                          {t("pageCreate.aiDiscard")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("pageCreate.aiPreviewZoom")}
                          title={t("pageCreate.aiPreviewZoom")}
                          onClick={() => setZoomed(true)}
                        >
                          <Maximize2 aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div
                    aria-label={rightLabel}
                    role="region"
                    tabIndex={0}
                    aria-busy={aiBusy || refining}
                    className={cn(
                      "focus-visible:ring-ring wh-scroll relative min-h-40 flex-1 overflow-y-auto rounded-md border focus-visible:ring-2 focus-visible:outline-none",
                      draft === null && !(asking && clarifyHistory.length > 0)
                        ? "border-border bg-surface-sunken border-dashed"
                        : "border-border bg-surface px-4 py-3",
                    )}
                  >
                    {asking && clarify ? (
                      <div className="space-y-3">
                        {clarify.summary ? (
                          <div className="bg-surface-sunken border-border text-muted-foreground rounded-md border px-3 py-2 text-xs leading-relaxed">
                            {clarify.summary}
                          </div>
                        ) : null}

                        {clarifyHistory.length > 0 ? (
                          <ul className="space-y-2">
                            {clarifyHistory.map((entry, idx) => (
                              <li
                                key={`${entry.question.question}-${idx}`}
                                className="border-border bg-surface-sunken/70 group rounded-md border p-2.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {entry.question.header ? (
                                        <span className="bg-primary-subtle text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
                                          {entry.question.header}
                                        </span>
                                      ) : null}
                                      <span className="text-muted-foreground text-xs">
                                        {entry.answer.question}
                                      </span>
                                    </div>
                                    <p className="text-foreground text-xs font-medium">
                                      {entry.answer.answer}
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-foreground h-6 shrink-0 px-1.5 text-[11px]"
                                    disabled={aiBusy || clarifyThinking}
                                    title={t("pageCreate.aiRewindTo")}
                                    aria-label={t("pageCreate.aiRewindTo")}
                                    onClick={() => handleRewindTo(idx)}
                                  >
                                    <Pencil className="size-3" aria-hidden />
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                            <span className="bg-primary-subtle text-primary flex size-9 items-center justify-center rounded-full">
                              <Sparkles className="size-4" aria-hidden />
                            </span>
                            <p className="text-sm font-medium">
                              {t("pageCreate.aiDecisionsEmptyTitle")}
                            </p>
                            <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
                              {t("pageCreate.aiDecisionsEmpty")}
                            </p>
                          </div>
                        )}

                        {clarify.related.length > 0 ? (
                          <div className="border-border space-y-1.5 border-t pt-3">
                            <p className="text-muted-foreground text-xs font-medium">
                              {t("pageCreate.aiRelatedTitle")}
                            </p>
                            <ul className="space-y-1">
                              {clarify.related.map((page) => (
                                <li key={page.id}>
                                  <a
                                    href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="text-primary hover:bg-surface-hover focus-visible:ring-ring block rounded px-1.5 py-1 text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                                  >
                                    {page.title}
                                    <span className="text-muted-foreground ml-1.5 text-[11px]">
                                      {page.space_name}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : showRelated && clarify ? (
                      <div className="space-y-2 px-4 py-3">
                        <ul className="space-y-1">
                          {clarify.related.map((page) => (
                            <li key={page.id}>
                              <a
                                href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-primary hover:bg-surface-hover focus-visible:ring-ring block rounded px-1.5 py-1 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                              >
                                {page.title}
                                <span className="text-muted-foreground ml-1.5 text-xs">
                                  {page.space_name}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                        <p className="text-muted-foreground text-xs">
                          {t("pageCreate.aiRelatedHint")}
                        </p>
                      </div>
                    ) : draft === null && !aiBusy ? (
                      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
                        <span className="bg-primary-subtle text-primary flex size-10 items-center justify-center rounded-full">
                          <Sparkles className="size-5" aria-hidden />
                        </span>
                        <p className="text-sm font-medium">
                          {t("pageCreate.aiPreviewEmptyTitle")}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t("pageCreate.aiPreviewEmpty")}
                        </p>
                      </div>
                    ) : draft === null ? (
                      <div
                        role="status"
                        className="flex animate-pulse flex-col gap-2.5 px-5 py-4"
                      >
                        <span className="text-muted-foreground mb-1 text-xs">
                          {clarify === null && clarifyMode === "deep"
                            ? t("pageCreate.aiSearching")
                            : t("pageCreate.aiGenerating")}
                        </span>
                        <div className="bg-border h-12 rounded-md" />
                        <div className="bg-border h-4 w-2/5 rounded" />
                        <div className="bg-border h-3 rounded" />
                        <div className="bg-border h-3 w-11/12 rounded" />
                        <div className="bg-border h-3 w-4/5 rounded" />
                        <div className="bg-border mt-2 h-4 w-1/3 rounded" />
                        <div className="bg-border h-3 rounded" />
                        <div className="bg-border h-3 w-3/4 rounded" />
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "transition-opacity duration-150",
                          (aiBusy || refining) && "opacity-40",
                        )}
                      >
                        <DraftPreview content={draft} />
                      </div>
                    )}
                  </div>

                  {draft !== null && !asking ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={refineInput}
                        disabled={aiBusy || refining}
                        onChange={(event) => setRefineInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleRefine();
                          }
                        }}
                        maxLength={2000}
                        aria-label={t("pageCreate.aiRefinePlaceholder")}
                        placeholder={t("pageCreate.aiRefinePlaceholder")}
                        className={cn(inputClassName, "h-8 flex-1 text-xs")}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0 px-2.5 text-xs"
                        disabled={
                          aiBusy || refining || refineInput.trim().length < 2
                        }
                        onClick={() => void handleRefine()}
                      >
                        {refining ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Sparkles aria-hidden />
                        )}
                        {refining
                          ? t("pageCreate.aiRefining")
                          : t("pageCreate.aiRefineSend")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {mode === "ai" && aiKnown && !aiOn && canConfigure ? (
              <Button asChild variant="secondary">
                <Link href="/admin/ai">{t("ai.openSettings")}</Link>
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              disabled={
                pending ||
                !title.trim() ||
                (mode === "ai" &&
                  (!aiOn || draft === null || aiBusy || refining))
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
              {pending ? t("pageCreate.creating") : t("pageCreate.createTitle")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <Dialog open={zoomed && draft !== null} onOpenChange={setZoomed}>
        <DialogContent
          className="max-w-5xl"
          title={title.trim() || t("pageCreate.aiPreviewLabel")}
          description={t("pageCreate.aiPreviewLabel")}
        >
          <div className="border-border bg-surface wh-scroll max-h-[78vh] overflow-y-auto rounded-md border px-6 py-4">
            {draft !== null ? <DraftPreview content={draft} /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
