"use client";

import {
  FilePlus2,
  Info,
  Loader2,
  Maximize2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AiClarifyQuestions } from "@/components/pages/ai-clarify-questions";
import { AiNotSetUp } from "@/components/pages/ai-not-set-up";
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
  type PageAnswer,
  type PageClarify,
} from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { WikiPage } from "@/types/api";

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
  triggerVariant = "primary",
  triggerSize = "md",
}: {
  spaceKey: string;
  parentPage?: Pick<WikiPage, "id" | "title"> | null;
  triggerLabel?: string;
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
  const [aiBusy, setAiBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [clarify, setClarify] = useState<PageClarify | null>(null);
  const [answers, setAnswers] = useState<PageAnswer[]>([]);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void aiStatus().then((status) => {
      if (!active) return;
      setAiOn(Boolean(status?.enabled));
      setCanConfigure(Boolean(status?.can_configure));
      setAiKnown(true);
    });
    return () => {
      active = false;
    };
  }, [open]);

  // The AI first looks the request up in the wiki and may ask questions; the
  // answers (and the pages it found) are kept so Regenerate does not ask again.
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
      });
      setDraft(result.content);
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
    if (prompt.length < 3 || aiBusy) return;
    setAiError(null);
    const known = fresh ? null : clarify;
    if (known) {
      await writeDraft(prompt, { answers, related: known.related });
      return;
    }
    setAiBusy(true);
    setAnswers([]);
    try {
      const found = await clarifyPage(spaceKey, {
        prompt,
        title: title.trim(),
        lang: locale,
      });
      setClarify(found);
      if (found.questions.length > 0) {
        setAsking(true);
        setAiBusy(false);
        return;
      }
    } catch (error) {
      setAiError(aiErrorText(error));
      setAiBusy(false);
      return;
    }
    setAiBusy(false);
    await writeDraft(prompt, { answers: [], related: [] });
  }

  // The answers become part of the description itself, so the author sees (and
  // can still edit) everything the draft is built from, and Regenerate needs no
  // separate answers.
  async function answered(given: PageAnswer[]) {
    setAiError(null);
    setAsking(false);
    const details = given.map((item) => `- ${item.question}: ${item.answer}`);
    const prompt = [
      aiPrompt.trim(),
      ...(details.length ? ["", ...details] : []),
    ]
      .join("\n")
      .slice(0, 2000);
    setAiPrompt(prompt);
    setAnswers([]);
    await writeDraft(prompt, { answers: [], related: clarify?.related ?? [] });
  }

  function changePrompt(value: string) {
    setAiError(null);
    setAiPrompt(value);
    // A new description needs its own look-up and questions.
    setClarify(null);
    setAnswers([]);
    setAsking(false);
  }

  // From the Write tab: whatever was typed (or, failing that, the title) is the
  // description, and the draft starts straight away instead of an empty form.
  function draftFromWritten() {
    const seed = content.trim() || title.trim();
    setMode("ai");
    if (seed.length < 3) return;
    changePrompt(seed.slice(0, 2000));
    void generate(seed.slice(0, 2000), true);
  }

  function discardDraft() {
    setDraft(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setPending(true);
    try {
      const page = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages`,
        {
          title: trimmedTitle,
          content: draft ?? content,
          parent_id: parentPage?.id ?? null,
        },
      );
      toast.success(t("pageCreate.createdToast", { title: page.title }));
      setOpen(false);
      setTitle("");
      setContent("");
      setDraft(null);
      setMode("write");
      setAiPrompt("");
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

  // Before there is a draft, the right-hand side lists the wiki pages found for
  // the request - and says so, rather than calling that list a preview.
  const showRelated =
    draft === null && !aiBusy && clarify !== null && clarify.related.length > 0;
  const rightLabel = showRelated
    ? t("pageCreate.aiRelatedTitle")
    : t("pageCreate.aiPreviewLabel");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          aria-label={triggerLabel || t("pageCreate.newPageAria")}
          title={triggerLabel || t("pageCreate.newPageAria")}
        >
          <FilePlus2 />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={aiKnown ? "max-w-4xl" : undefined}
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
                className={cn("flex flex-col gap-2", aiKnown && "md:h-[22rem]")}
              >
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
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
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
              </div>
            ) : (
              <div className="grid gap-5 md:h-[22rem] md:grid-cols-2">
                {asking && clarify ? (
                  <div className="flex min-h-0 flex-col gap-2">
                    <div className="flex h-7 items-center">
                      <span className="text-sm leading-none font-medium">
                        {t("pageCreate.aiQuestionsTitle")}
                      </span>
                    </div>
                    <AiClarifyQuestions
                      questions={clarify.questions}
                      busy={aiBusy}
                      onSubmit={(given) => void answered(given)}
                      onSkip={() => void answered([])}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-col gap-2">
                    <div className="flex h-7 items-center">
                      <Label htmlFor="page-ai-prompt">
                        {t("pageCreate.aiPromptLabel")}
                      </Label>
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
                      maxLength={2000}
                      disabled={aiBusy}
                    />
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
                          disabled={aiBusy}
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
                      disabled={aiBusy || aiPrompt.trim().length < 3}
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
                    <span className="text-sm leading-none font-medium">
                      {rightLabel}
                    </span>
                    {draft !== null ? (
                      <div className="-mr-1.5 flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-7 px-2"
                          disabled={aiBusy}
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
                    aria-busy={aiBusy}
                    className={cn(
                      "focus-visible:ring-ring wh-scroll relative min-h-40 flex-1 overflow-y-auto rounded-md border focus-visible:ring-2 focus-visible:outline-none",
                      draft === null
                        ? "border-border bg-surface-sunken border-dashed"
                        : "border-border bg-surface px-4 py-3",
                    )}
                  >
                    {showRelated && clarify ? (
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
                          {clarify === null
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
                          aiBusy && "opacity-40",
                        )}
                      >
                        <DraftPreview content={draft} />
                      </div>
                    )}
                  </div>
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
                (mode === "ai" && (!aiOn || draft === null || aiBusy))
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
          className="max-w-4xl"
          title={title.trim() || t("pageCreate.aiPreviewLabel")}
          description={t("pageCreate.aiPreviewLabel")}
        >
          <div className="border-border bg-surface wh-scroll max-h-[70vh] overflow-y-auto rounded-md border px-6 py-4">
            {draft !== null ? <DraftPreview content={draft} /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
