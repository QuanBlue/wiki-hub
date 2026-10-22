"use client";

import {
  Check,
  FileText,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, describeApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import {
  deleteQuestion,
  filterQuestions,
  loadQuestions,
  reopenQuestion,
  resolveQuestion,
  setQuestionRecording,
  sortedReasons,
} from "@/lib/question-gaps";
import { formatRelative } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type {
  QuestionGroup,
  QuestionGroupList,
  QuestionPage,
  SearchResultPage,
  SearchResults,
} from "@/types/api";

type Status = "open" | "resolved";

function pageHref(page: Pick<QuestionPage, "space_key" | "slug">): string {
  return `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`;
}

const LINK =
  "text-primary focus-visible:ring-ring rounded-sm underline-offset-4 transition-colors " +
  "duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none";

/**
 * "Mark answered": pick the page that answers the question now. Whoever asked is told, if
 * they may read it. A page is optional - answered elsewhere is still answered.
 */
function AnswerDialog({
  group,
  pending,
  onClose,
  onConfirm,
}: {
  group: QuestionGroup | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (page: SearchResultPage | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultPage[]>([]);
  const [picked, setPicked] = useState<SearchResultPage | null>(null);
  const [searching, setSearching] = useState(false);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api
        .get<SearchResults>(`/api/v1/search?q=${encodeURIComponent(term)}&limit=8`)
        .then((found) => {
          if (live) setResults(found.pages);
        })
        .catch(() => {
          if (live) setResults([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const shown = term.length < 2 ? [] : results;

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setResults([]);
          setPicked(null);
          onClose();
        }
      }}
    >
      {group ? (
        <DialogContent
          className="max-w-lg"
          title={t("adminAi.questionsAnswerTitle")}
          description={t("adminAi.questionsAnswerDescription", { question: group.question })}
        >
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("adminAi.questionsAnswerSearch")}
                aria-label={t("adminAi.questionsAnswerSearch")}
                className="pl-9"
                autoFocus
              />
            </div>
            {picked ? (
              <div className="border-primary/40 bg-primary-subtle flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileText className="text-primary size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{picked.title}</span>
                  <span className="text-muted-foreground"> · {picked.space_name}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("adminAi.questionsAnswerClear")}
                  title={t("adminAi.questionsAnswerClear")}
                  onClick={() => setPicked(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : null}
            {searching ? (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("adminAi.questionsAnswerSearching")}
              </p>
            ) : shown.length > 0 ? (
              <ul className="border-border divide-border max-h-60 divide-y overflow-y-auto rounded-lg border">
                {shown.map((page) => (
                  <li key={page.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(page)}
                      aria-pressed={picked?.id === page.id}
                      className={cn(
                        "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                        picked?.id === page.id
                          ? "bg-surface-selected"
                          : "hover:bg-surface-hover active:bg-surface-selected",
                      )}
                    >
                      <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{page.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {page.space_name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : term.length >= 2 ? (
              <p className="text-muted-foreground text-xs">{t("adminAi.questionsAnswerNone")}</p>
            ) : null}
            <p className="text-muted-foreground text-xs leading-5">
              {t("adminAi.questionsAnswerHint")}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={() => onConfirm(picked)}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Check />}
                {picked
                  ? t("adminAi.questionsAnswerConfirmPage")
                  : t("adminAi.questionsAnswerConfirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function QuestionRow({
  group,
  status,
  busy,
  onAnswer,
  onDismiss,
  onReopen,
  onDelete,
}: {
  group: QuestionGroup;
  status: Status;
  busy: boolean;
  onAnswer: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useTranslation();
  const others = group.variants.filter((text) => text !== group.question);
  const askers = group.askers.map((asker) => asker.name).join(", ");
  return (
    <li className="hover:bg-surface-hover flex flex-col gap-2 px-4 py-3 transition-colors duration-150 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-foreground min-w-0 text-sm font-medium break-words">
            {group.question}
          </p>
          <Badge
            variant={group.count > 1 ? "warning" : "neutral"}
            className="font-mono text-[11px]"
            title={t("adminAi.questionsTimes", { count: group.count })}
          >
            ×{group.count}
          </Badge>
        </div>
        {group.standalone ? (
          <p className="text-muted-foreground text-xs">
            {t("adminAi.questionsStandalone", { text: group.standalone })}
          </p>
        ) : null}
        {others.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("adminAi.questionsAlso", { list: others.map((text) => `“${text}”`).join(", ") })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {sortedReasons(group).map((reason) => (
            <span
              key={reason}
              className={cn(
                "rounded-full px-1.5 py-px text-[11px] font-medium",
                reason === "disliked"
                  ? "bg-danger-bg text-danger"
                  : reason === "no_match" || reason === "not_in_pages"
                    ? "bg-warning-bg text-warning"
                    : "bg-surface-sunken text-muted-foreground",
              )}
            >
              {t(`adminAi.questionsReason_${reason}`)}
            </span>
          ))}
          {group.surfaces.map((surface) => (
            <span
              key={surface}
              className="bg-surface-sunken text-muted-foreground rounded-full px-1.5 py-px text-[11px]"
            >
              {t(`adminAi.questionsSurface_${surface}`)}
            </span>
          ))}
        </div>
        <p
          className="text-muted-foreground text-xs"
          title={formatDateTime(group.last_asked_at, locale)}
        >
          {[
            askers ? t("adminAi.questionsAskedBy", { names: askers }) : null,
            t("adminAi.questionsLastAsked", { when: formatRelative(group.last_asked_at, locale) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {group.near_pages.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("adminAi.questionsNear")}{" "}
            {group.near_pages.map((page, index) => (
              <span key={page.id}>
                {index > 0 ? ", " : null}
                <Link href={pageHref(page)} className={LINK}>
                  {page.title}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
        {group.answer_excerpt ? (
          <blockquote className="border-border text-muted-foreground line-clamp-3 border-l-2 pl-2 text-xs">
            {t("adminAi.questionsDislikedAnswer")} {group.answer_excerpt}
          </blockquote>
        ) : null}
        {status === "resolved" ? (
          <p className="text-success text-xs">
            {group.resolution === "answered"
              ? t("adminAi.questionsResolvedAnswered")
              : t("adminAi.questionsResolvedDismissed")}
            {group.answer_page ? (
              <>
                {" "}
                <Link href={pageHref(group.answer_page)} className={LINK}>
                  {group.answer_page.title}
                </Link>
              </>
            ) : null}
            {group.resolved_at ? ` · ${formatRelative(group.resolved_at, locale)}` : null}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:pl-2">
        {status === "open" ? (
          <>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onAnswer}>
              <Check />
              {t("adminAi.questionsAnswer")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
              {busy ? <Loader2 className="animate-spin" /> : <X />}
              {t("adminAi.questionsDismiss")}
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onReopen}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {t("adminAi.questionsReopen")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("adminAi.questionsDelete")}
          title={t("adminAi.questionsDelete")}
          className="text-muted-foreground hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85 size-7"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

/**
 * Admin > AI assistant > Unanswered questions: what people asked the assistant that the wiki
 * did not answer (or whose answer they marked unhelpful), the same question once however often
 * it was asked. The most asked first: those are the pages most worth writing.
 */
export function AiQuestionsPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("open");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ request: string; list: QuestionGroupList | null } | null>(
    null,
  );
  const [filter, setFilter] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [answering, setAnswering] = useState<QuestionGroup | null>(null);
  const [deleting, setDeleting] = useState<QuestionGroup | null>(null);
  const [pending, setPending] = useState(false);
  const [recording, setRecording] = useState<boolean | null>(null);
  const request = `${status}:${attempt}`;

  useEffect(() => {
    let live = true;
    loadQuestions(status)
      .then((list) => {
        if (!live) return;
        setLoaded({ request: `${status}:${attempt}`, list });
        setRecording(list.recording);
      })
      .catch(() => {
        if (live) setLoaded({ request: `${status}:${attempt}`, list: null });
      });
    return () => {
      live = false;
    };
  }, [status, attempt]);

  const current = loaded && loaded.request === request ? loaded : null;
  const list = current?.list ?? null;
  const failed = current !== null && list === null;
  const shown = list ? filterQuestions(list.items, filter) : [];

  const drop = (key: string) =>
    setLoaded((value) => {
      if (!value?.list) return value;
      const { list } = value;
      return { ...value, list: { ...list, items: list.items.filter((g) => g.key !== key) } };
    });

  async function act(group: QuestionGroup, run: () => Promise<void>, done: string) {
    setBusyKey(group.key);
    try {
      await run();
      drop(group.key);
      toast.success(done);
    } catch (error) {
      toast.error(describeApiError(error, t("adminAi.questionsActionError")));
    } finally {
      setBusyKey(null);
    }
  }

  async function answer(page: SearchResultPage | null) {
    if (!answering) return;
    setPending(true);
    try {
      await resolveQuestion(answering.key, "answered", page);
      drop(answering.key);
      toast.success(
        page ? t("adminAi.questionsAnsweredWithPage") : t("adminAi.questionsAnswered"),
      );
      setAnswering(null);
    } catch (error) {
      toast.error(describeApiError(error, t("adminAi.questionsActionError")));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setPending(true);
    try {
      await deleteQuestion(deleting.key);
      drop(deleting.key);
      toast.success(t("adminAi.questionsDeleted"));
      setDeleting(null);
    } catch (error) {
      toast.error(describeApiError(error, t("adminAi.questionsActionError")));
    } finally {
      setPending(false);
    }
  }

  async function toggleRecording() {
    if (recording === null) return;
    const next = !recording;
    setRecording(next);
    try {
      await setQuestionRecording(next);
      toast.success(next ? t("adminAi.questionsRecordingOn") : t("adminAi.questionsRecordingOff"));
    } catch (error) {
      setRecording(!next);
      toast.error(describeApiError(error, t("adminAi.questionsActionError")));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("adminAi.questionsTitle")}</h3>
          <p className="text-muted-foreground mt-0.5 max-w-2xl text-sm">
            {t("adminAi.questionsIntro", { days: list?.retention_days ?? 90 })}
          </p>
        </div>
        {recording !== null ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("adminAi.questionsRecording")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={recording}
              aria-label={t("adminAi.questionsRecording")}
              onClick={() => void toggleRecording()}
              className={cn(
                "focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                recording ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "bg-surface pointer-events-none inline-block size-4 rounded-full shadow-sm transition-transform duration-150",
                  recording ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t("adminAi.questionsStatus")}
          className="bg-surface-sunken flex gap-1 rounded-lg p-1"
        >
          {(["open", "resolved"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={status === option}
              onClick={() => setStatus(option)}
              className={cn(
                "focus-visible:ring-ring cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                status === option
                  ? "bg-surface text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
              )}
            >
              {t(option === "open" ? "adminAi.questionsOpen" : "adminAi.questionsResolved")}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("adminAi.questionsFilter")}
            aria-label={t("adminAi.questionsFilter")}
            className="pl-9"
          />
        </div>
      </div>

      {failed ? (
        <div className="border-border rounded-xl border p-6 text-center" role="alert">
          <p className="text-sm font-medium">{t("adminAi.questionsLoadError")}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("health.retry")}
          </Button>
        </div>
      ) : list === null ? (
        <p className="text-muted-foreground flex items-center text-sm">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          {t("adminAi.questionsLoading")}
        </p>
      ) : list.items.length === 0 ? (
        <div className="border-border rounded-xl border border-dashed px-6 py-12 text-center">
          <span className="bg-surface-sunken text-muted-foreground mx-auto grid size-12 place-items-center rounded-full">
            <MessageCircleQuestion className="size-6" aria-hidden />
          </span>
          <p className="mt-3 text-sm font-medium">
            {status === "open"
              ? t("adminAi.questionsEmptyOpen")
              : t("adminAi.questionsEmptyResolved")}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-5">
            {list.recording ? t("adminAi.questionsEmptyHint") : t("adminAi.questionsEmptyOff")}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          {t("adminAi.questionsNoMatch", { query: filter.trim() })}
        </p>
      ) : (
        <ul className="border-border bg-surface divide-border divide-y rounded-xl border">
          {shown.map((group) => (
            <QuestionRow
              key={group.key}
              group={group}
              status={status}
              busy={busyKey === group.key}
              onAnswer={() => setAnswering(group)}
              onDismiss={() =>
                void act(
                  group,
                  () => resolveQuestion(group.key, "dismissed"),
                  t("adminAi.questionsDismissed"),
                )
              }
              onReopen={() =>
                void act(group, () => reopenQuestion(group.key), t("adminAi.questionsReopened"))
              }
              onDelete={() => setDeleting(group)}
            />
          ))}
        </ul>
      )}

      <AnswerDialog
        group={answering}
        pending={pending}
        onClose={() => setAnswering(null)}
        onConfirm={(page) => void answer(page)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("adminAi.questionsDeleteTitle")}
        description={t("adminAi.questionsDeleteDescription", {
          question: deleting?.question ?? "",
          count: deleting?.count ?? 0,
        })}
        confirmLabel={t("adminAi.questionsDelete")}
        destructive
        pending={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
