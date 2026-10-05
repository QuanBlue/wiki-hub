import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { LabelChip } from "@/components/issues/label-chip";
import { IssueScreenshots } from "@/components/issues/issue-screenshots";
import {
  IssueStatusBadge,
  IssueStatusBar,
} from "@/components/issues/issue-status-badge";
import { Pagination } from "@/components/ui/pagination";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { formatDateTime } from "@/lib/i18n/format";
import { getServerLocale } from "@/lib/i18n/server";
import { listMyIssues } from "@/lib/issues";

export const metadata: Metadata = { title: "My issues" };
export const dynamic = "force-dynamic";

/** The problems the signed-in user reported, and where each stands. */
const PAGE_SIZE = 20;

export default async function MyIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const requested = Number((await searchParams).page);
  const pageNumber =
    Number.isInteger(requested) && requested >= 1 ? requested : 1;
  const [{ items, total }, { t, locale }] = await Promise.all([
    listMyIssues(PAGE_SIZE, (pageNumber - 1) * PAGE_SIZE),
    getServerLocale(),
  ]);

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="border-border flex flex-wrap items-start justify-between gap-3 border-b pb-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("issues.myTitle")}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("issues.myDescription")}
            </p>
          </div>
          <ReportIssueButton />
        </header>

        {items.length === 0 ? (
          <p className="border-border bg-surface text-muted-foreground rounded-xl border p-8 text-center text-sm">
            {t("issues.myEmpty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((issue) => (
              <li
                key={issue.id}
                className="border-border bg-surface space-y-3 rounded-xl border p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="min-w-0 font-semibold break-words">
                    {issue.title}
                  </h2>
                  <IssueStatusBadge status={issue.status} />
                </div>
                {issue.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {issue.labels.map((slug) => (
                      <LabelChip key={slug} slug={slug} />
                    ))}
                  </div>
                ) : null}
                {issue.description ? (
                  <IssueMarkdown
                    source={issue.description}
                    className="text-muted-foreground"
                  />
                ) : null}
                <IssueScreenshots attachments={issue.attachments} />
                <IssueStatusBar status={issue.status} />
                {issue.notes.map((note) => (
                  <div
                    key={note.id}
                    className="border-primary bg-primary-subtle rounded-md border-l-2 p-3"
                  >
                    <p className="text-xs font-medium">
                      {t("issues.noteFrom", {
                        name: note.author
                          ? note.author.full_name || note.author.username
                          : t("adminIssues.unknownAuthor"),
                      })}
                      <span className="text-muted-foreground ml-2 font-normal">
                        {formatDateTime(note.created_at, locale)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                      {note.body}
                    </p>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  {t("issues.reportedOn", {
                    date: formatDateTime(issue.created_at, locale),
                  })}
                  {" · "}
                  {issue.assignee
                    ? t("issues.takenBy", {
                        name:
                          issue.assignee.full_name || issue.assignee.username,
                      })
                    : t("issues.notTaken")}
                  {issue.resolved_at
                    ? ` · ${t("issues.closedOn", { date: formatDateTime(issue.resolved_at, locale) })}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}

        <Pagination
          page={pageNumber}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          hrefFor={(next) => (next === 1 ? "/issues" : `/issues?page=${next}`)}
          previousLabel={t("adminIssues.previous")}
          nextLabel={t("adminIssues.next")}
          className="justify-center"
        />
      </div>
    </AppShell>
  );
}
