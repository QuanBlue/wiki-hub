"use client";

import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Hand,
  Info,
  ImageIcon,
  Loader2,
  RotateCcw,
  Search,
  StickyNote,
  UserCheck,
  UserPen,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Highlight } from "@/components/issues/highlight";
import { LabelChip } from "@/components/issues/label-chip";
import { LabelPicker } from "@/components/issues/label-picker";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { IssueScreenshots } from "@/components/issues/issue-screenshots";
import {
  IssueStatusBadge,
  IssueStatusBar,
} from "@/components/issues/issue-status-badge";
import {
  PeoplePicker,
  type PickerOption,
} from "@/components/issues/people-picker";
import { ReportIssueDialog } from "@/components/issues/report-issue-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Explains what a button does on hover/focus. The trigger is a span so the
 * hint still shows while the button inside is disabled.
 */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  Issue,
  IssueBulkResult,
  IssueCounts,
  IssuePerson,
  IssueStatus,
  Page,
} from "@/types/api";

const PAGE_SIZES = [10, 20, 50, 100];
/** The assign picker's value for "nobody" (it is not a user id). */
const NOBODY = "__nobody__";

type StateTab = "open" | "closed";
type Sort = "newest" | "oldest" | "updated" | "stale";
const SORTS: { value: Sort; key: string }[] = [
  { value: "newest", key: "adminIssues.sortNewest" },
  { value: "oldest", key: "adminIssues.sortOldest" },
  { value: "updated", key: "adminIssues.sortUpdated" },
  { value: "stale", key: "adminIssues.sortStale" },
];

/** The saved views down the left: which issues, before anything is searched. */
type View = "all" | "assigned" | "created";
const VIEWS: { view: View; icon: typeof CircleDot; key: string }[] = [
  { view: "all", icon: CircleDot, key: "adminIssues.viewAll" },
  { view: "assigned", icon: UserCheck, key: "adminIssues.viewAssigned" },
  { view: "created", icon: UserPen, key: "adminIssues.viewCreated" },
];

/** A small "i" that shows a longer explanation on hover/focus. */
function InfoHint({ label }: { label: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring cursor-pointer rounded-full p-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const STATUS_ICON: Record<
  IssueStatus,
  { icon: typeof CircleDot; tone: string }
> = {
  open: { icon: CircleDot, tone: "text-success" },
  in_progress: { icon: CircleDot, tone: "text-primary" },
  done: { icon: CheckCircle2, tone: "text-muted-foreground" },
};

const searchWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** A short stretch of the description around the first search hit, or null. */
function snippet(description: string, words: string[]): string | null {
  const flat = description.replace(/\s+/g, " ");
  const lower = flat.toLowerCase();
  const hits = words
    .map((word) => lower.indexOf(word.toLowerCase()))
    .filter((index) => index >= 0);
  if (hits.length === 0) return null;
  const at = Math.min(...hits);
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** A small menu button in the list's header: "Author ▾". */
function FilterMenu({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        className="text-muted-foreground hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-selected focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        {icon}
        {label}
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-60 overflow-y-auto"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChoiceItem({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="text-foreground justify-between"
    >
      <span className="truncate">{children}</span>
      {selected ? <Check className="text-primary" aria-hidden /> : null}
    </DropdownMenuItem>
  );
}

/**
 * Every reported issue, laid out like the instance settings: a section list on
 * the left, and one card on the right with its own header and actions. The
 * search box looks in titles and descriptions only (what matches is marked
 * blue); who reported it, who took it, open/closed and the order are menus.
 */
export function IssuesList({ openId }: { openId?: string }) {
  const { t, locale, apiErrorText } = useTranslation();
  // What is typed, versus what has been searched: the list only changes on
  // Enter or the Search button, not on every keystroke.
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<StateTab>("open");
  const [author, setAuthor] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("newest");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1]!);
  const [page, setPage] = useState<Page<Issue> | null>(null);
  const [counts, setCounts] = useState<IssueCounts | null>(null);
  const [people, setPeople] = useState<IssuePerson[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignable, setAssignable] = useState<IssuePerson[]>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const total = page?.total ?? 0;
  const items = page?.items ?? [];
  // Only ticks that are still on screen count: a reload can drop issues from view.
  const chosenIds = items
    .filter((issue) => selectedIds.has(issue.id))
    .map((issue) => issue.id);
  const allSelected = items.length > 0 && chosenIds.length === items.length;
  const [noteDraft, setNoteDraft] = useState("");
  const [closingNote, setClosingNote] = useState("");
  // The issue whose closing note is being written: it appears after "Mark done".
  const [closingFor, setClosingFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Search as you type, like the WikiHub search: settle briefly, then look.
  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => {
      setSearch(draft);
      setOffset(0);
      setSelectedIds(new Set());
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, search]);

  const filters = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (author) params.set("author", author);
    if (assignee) params.set("assignee", assignee);
    labels.forEach((label) => params.append("label", label));
    return params;
  }, [search, author, assignee, labels]);

  useEffect(() => {
    let active = true;
    const params = filters();
    params.set("state", state);
    if (sort !== "newest") params.set("sort", sort);
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    void api
      .get<Page<Issue>>(`/api/v1/issues?${params.toString()}`)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((error: unknown) => {
        if (active) toast.error(apiErrorText(error, "adminIssues.loadError"));
      });
    return () => {
      active = false;
    };
  }, [filters, state, sort, offset, pageSize, reloadTick, apiErrorText]);

  // The tab numbers follow the search and filters, but not the tab itself.
  useEffect(() => {
    let active = true;
    void api
      .get<IssueCounts>(`/api/v1/issues/counts?${filters().toString()}`)
      .then((result) => {
        if (active) setCounts(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [filters, reloadTick]);

  useEffect(() => {
    let active = true;
    void api
      .get<IssuePerson[]>("/api/v1/issues/people")
      .then((result) => {
        if (active) setPeople(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [reloadTick]);

  useEffect(() => {
    let active = true;
    void api
      .get<IssuePerson[]>("/api/v1/issues/assignees")
      .then((result) => {
        if (active) setAssignable(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // "Some, not all" is shown as the box's own half-ticked state.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        chosenIds.length > 0 && chosenIds.length < items.length;
    }
  });

  // An issue opened straight from a notification's link.
  useEffect(() => {
    if (!openId) return;
    let active = true;
    void api
      .get<Issue>(`/api/v1/issues/${openId}`)
      .then((issue) => {
        if (active) setSelected(issue);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [openId]);

  const applyUpdated = useCallback((updated: Issue) => {
    setSelected((current) => (current?.id === updated.id ? updated : current));
    setReloadTick((tick) => tick + 1);
  }, []);

  async function act(
    request: () => Promise<Issue>,
    onDone: (issue: Issue) => string,
  ) {
    setBusy(true);
    try {
      const updated = await request();
      applyUpdated(updated);
      toast.success(onDone(updated));
      return true;
    } catch (error) {
      toast.error(apiErrorText(error, "adminIssues.actionError"));
      // The rules may have changed under us (someone else took it): re-read.
      setReloadTick((tick) => tick + 1);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const claim = (issue: Issue) =>
    act(
      () => api.post<Issue>(`/api/v1/issues/${issue.id}/claim`),
      () => t("adminIssues.claimed"),
    );
  const setStatus = (issue: Issue, status: IssueStatus) =>
    act(
      () => api.patch<Issue>(`/api/v1/issues/${issue.id}/status`, { status }),
      () => t("adminIssues.updated"),
    );
  /** Close it, with the optional note the reporter will read and be emailed. */
  const closeIssue = async (issue: Issue) => {
    const closed = await act(
      () =>
        api.patch<Issue>(`/api/v1/issues/${issue.id}/status`, {
          status: "done",
          note: closingNote.trim() || null,
        }),
      (updated) =>
        t(
          updated.email === "failed"
            ? "adminIssues.closedEmailFailed"
            : updated.email === "sent"
              ? "adminIssues.closedEmailed"
              : "adminIssues.updated",
        ),
    );
    if (closed) {
      setClosingNote("");
      setClosingFor(null);
    }
  };
  const addNote = async (issue: Issue) => {
    const added = await act(
      () =>
        api.post<Issue>(`/api/v1/issues/${issue.id}/notes`, {
          body: noteDraft.trim(),
        }),
      () => t("adminIssues.noteAdded"),
    );
    if (added) setNoteDraft("");
  };

  /** A filter changed: show the first page of the new result. */
  function change(apply: () => void) {
    apply();
    setOffset(0);
    setSelectedIds(new Set());
  }

  const personOption = (person: IssuePerson): PickerOption => ({
    value: person.username,
    primary: person.username,
    secondary:
      person.full_name.trim() && person.full_name.trim() !== person.username
        ? person.full_name.trim()
        : undefined,
  });
  const authorOptions: PickerOption[] = [
    { value: "@me", primary: t("adminIssues.createdByMe") },
    ...people.map(personOption),
  ];
  const assigneeOptions: PickerOption[] = [
    { value: "@me", primary: t("adminIssues.assignedToMe") },
    { value: "none", primary: t("adminIssues.assignedToNobody") },
    ...people.map(personOption),
  ];
  // Bulk assign picks by id, so the options carry the id as their value.
  const assignOptions: PickerOption[] = [
    { value: NOBODY, primary: t("adminIssues.unassign") },
    ...assignable.map((person) => ({
      ...personOption(person),
      value: person.id,
    })),
  ];

  const toggleOne = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds((current) =>
      items.length > 0 && items.every((issue) => current.has(issue.id))
        ? new Set()
        : new Set(items.map((issue) => issue.id)),
    );

  /** One change for every ticked issue; each is judged by its own rules. */
  async function bulk(change: {
    action: "status" | "assign" | "unassign";
    status?: IssueStatus;
    assignee_id?: string;
  }) {
    setBusy(true);
    try {
      const result = await api.post<IssueBulkResult>("/api/v1/issues/bulk", {
        ids: chosenIds,
        ...change,
      });
      const skipped = result.failed.length;
      if (skipped > 0) {
        toast.warning(
          t("adminIssues.bulkPartial", { updated: result.updated, skipped }),
        );
      } else {
        toast.success(t("adminIssues.bulkDone", { count: result.updated }));
      }
      setSelectedIds(new Set());
      setReloadTick((tick) => tick + 1);
    } catch (error) {
      toast.error(apiErrorText(error, "adminIssues.actionError"));
    } finally {
      setBusy(false);
    }
  }

  const words = searchWords(search);
  const isMe = (value: string | null) => value?.toLowerCase() === "@me";
  const activeView: View | null =
    isMe(assignee) && !author
      ? "assigned"
      : isMe(author) && !assignee
        ? "created"
        : !assignee && !author
          ? "all"
          : null;

  // The card's heading follows the view; custom filters keep the general one.
  const heading =
    activeView === "assigned"
      ? {
          title: "adminIssues.assignedTitle",
          description: "adminIssues.assignedDescription",
        }
      : activeView === "created"
        ? {
            title: "adminIssues.createdTitle",
            description: "adminIssues.createdDescription",
          }
        : {
            title: "adminIssues.title",
            description: "adminIssues.description",
          };

  function openView(view: View) {
    change(() => {
      setAssignee(view === "assigned" ? "@me" : null);
      setAuthor(view === "created" ? "@me" : null);
    });
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
  const openCount = (counts?.open ?? 0) + (counts?.in_progress ?? 0);
  const closedCount = counts?.done ?? 0;

  const tabClass = (active: boolean) =>
    cn(
      "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
      active
        ? "text-foreground font-semibold"
        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
    );
  const countChip = (value: number) => (
    <span className="bg-surface-hover text-foreground rounded-full px-2 py-0.5 text-xs font-medium">
      {value}
    </span>
  );

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-border lg:sticky lg:top-24 lg:border-r lg:pr-5">
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          {t("adminIssues.viewsHeading")}
        </p>
        <nav
          aria-label={t("adminIssues.viewsAria")}
          className="mt-3 flex gap-1 overflow-x-auto lg:flex-col"
        >
          {VIEWS.map(({ view, icon: Icon, key }) => {
            const selectedView = activeView === view;
            return (
              <button
                key={view}
                type="button"
                aria-current={selectedView ? "page" : undefined}
                onClick={() => openView(view)}
                className={cn(
                  "focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  selectedView
                    ? "bg-surface-selected text-primary hover:bg-surface-hover font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover font-normal",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(key)}
              </button>
            );
          })}
        </nav>
        <p className="border-border text-muted-foreground mt-5 hidden border-t px-2 pt-4 text-xs leading-relaxed lg:block">
          {t("adminIssues.sidebarNote")}
        </p>
      </aside>

      <section className="min-w-0">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3.5">
          <div className="flex items-center gap-2.5">
            <Bug className="text-primary size-5 shrink-0" aria-hidden />
            <div>
              <h3 className="text-foreground text-sm font-semibold sm:text-base">
                {t(heading.title)}
              </h3>
              <p className="text-muted-foreground mt-0.5 hidden text-xs sm:block">
                {t(heading.description)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="h-8 text-xs font-semibold"
            onClick={() => setCreating(true)}
          >
            <Bug className="size-3.5" /> {t("adminIssues.newIssue")}
          </Button>
        </div>

        <div className="space-y-4 pt-5">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              change(() => setSearch(draft));
            }}
            className="border-border bg-surface focus-within:border-border-strong focus-within:ring-ring flex items-center gap-1 rounded-md border pr-1 focus-within:ring-2"
          >
            <Search
              className="text-muted-foreground ml-3 size-4 shrink-0"
              aria-hidden
            />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t("adminIssues.searchAria")}
              placeholder={t("adminIssues.searchPlaceholder")}
              className="placeholder:text-muted-foreground h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {draft ? (
              <button
                type="button"
                aria-label={t("adminIssues.clearSearch")}
                onClick={() => {
                  setDraft("");
                  change(() => setSearch(""));
                }}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
            <Button type="submit" variant="ghost" size="sm" className="ml-1">
              <Search /> {t("adminIssues.search")}
            </Button>
          </form>

          <div className="border-border overflow-hidden rounded-lg border">
            <div className="bg-surface-sunken border-border flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex items-center gap-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  disabled={items.length === 0}
                  onChange={toggleAll}
                  aria-label={t("adminIssues.selectAll")}
                  className="accent-primary size-4 cursor-pointer disabled:cursor-not-allowed"
                />
                {chosenIds.length > 0 ? (
                  <span className="text-sm font-semibold">
                    {t("adminIssues.selectedCount", {
                      count: chosenIds.length,
                      total: items.length,
                    })}
                  </span>
                ) : (
                  <div
                    role="group"
                    aria-label={t("adminIssues.stateAria")}
                    className="flex items-center gap-1"
                  >
                    <button
                      type="button"
                      aria-pressed={state === "open"}
                      onClick={() => change(() => setState("open"))}
                      className={tabClass(state === "open")}
                    >
                      <CircleDot className="size-4" aria-hidden />
                      {t("adminIssues.tabOpen")} {countChip(openCount)}
                    </button>
                    <button
                      type="button"
                      aria-pressed={state === "closed"}
                      onClick={() => change(() => setState("closed"))}
                      className={tabClass(state === "closed")}
                    >
                      <Check className="size-4" aria-hidden />
                      {t("adminIssues.tabClosed")} {countChip(closedCount)}
                    </button>
                  </div>
                )}
              </div>

              {chosenIds.length > 0 ? (
                <div className="flex flex-wrap items-center">
                  <FilterMenu
                    label={t("adminIssues.markAs")}
                    icon={<CircleDot className="size-3.5" aria-hidden />}
                    disabled={busy}
                  >
                    <DropdownMenuLabel>
                      {t("adminIssues.markSelectedAs")}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() =>
                        void bulk({ action: "status", status: "open" })
                      }
                      className="text-foreground"
                    >
                      <CircleDot className="text-success" aria-hidden />
                      {t("issues.statusOpen")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void bulk({ action: "status", status: "in_progress" })
                      }
                      className="text-foreground"
                    >
                      <CircleDot className="text-primary" aria-hidden />
                      {t("issues.statusInProgress")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void bulk({ action: "status", status: "done" })
                      }
                      className="text-foreground"
                    >
                      <CheckCircle2
                        className="text-muted-foreground"
                        aria-hidden
                      />
                      {t("adminIssues.completed")}
                    </DropdownMenuItem>
                  </FilterMenu>
                  <PeoplePicker
                    disabled={busy}
                    trigger={
                      <>
                        <Users className="size-3.5" aria-hidden />
                        {t("adminIssues.assign")}
                      </>
                    }
                    title={t("adminIssues.applyAssignee")}
                    filterPlaceholder={t("adminIssues.filterAssignees")}
                    noMatch={t("adminIssues.noPeopleMatch")}
                    options={assignOptions}
                    selected={null}
                    onPick={(value) =>
                      void bulk(
                        value === NOBODY
                          ? { action: "unassign" }
                          : { action: "assign", assignee_id: value },
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <X /> {t("adminIssues.clearSelection")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center">
                  <PeoplePicker
                    trigger={t("adminIssues.author")}
                    title={t("adminIssues.filterByAuthor")}
                    filterPlaceholder={t("adminIssues.filterAuthors")}
                    noMatch={t("adminIssues.noPeopleMatch")}
                    options={authorOptions}
                    selected={author}
                    onPick={(value) =>
                      change(() =>
                        setAuthor((current) =>
                          current?.toLowerCase() === value.toLowerCase()
                            ? null
                            : value,
                        ),
                      )
                    }
                  />
                  <PeoplePicker
                    trigger={t("adminIssues.assignee")}
                    title={t("adminIssues.filterByAssignee")}
                    filterPlaceholder={t("adminIssues.filterAssignees")}
                    noMatch={t("adminIssues.noPeopleMatch")}
                    options={assigneeOptions}
                    selected={assignee}
                    onPick={(value) =>
                      change(() =>
                        setAssignee((current) =>
                          current?.toLowerCase() === value.toLowerCase()
                            ? null
                            : value,
                        ),
                      )
                    }
                  />
                  <LabelPicker
                    selected={labels}
                    onChange={(next) => change(() => setLabels(next))}
                    title={t("issueLabels.filterTitle")}
                    trigger={t("issueLabels.labels")}
                    allowNone
                    align="end"
                  />
                  <FilterMenu
                    label={t(
                      SORTS.find((s) => s.value === sort)?.key ??
                        "adminIssues.sortNewest",
                    )}
                    icon={<ArrowUpDown className="size-3.5" aria-hidden />}
                  >
                    <DropdownMenuLabel>
                      {t("adminIssues.sortBy")}
                    </DropdownMenuLabel>
                    {SORTS.map(({ value, key }) => (
                      <ChoiceItem
                        key={value}
                        selected={sort === value}
                        onSelect={() => change(() => setSort(value))}
                      >
                        {t(key)}
                      </ChoiceItem>
                    ))}
                  </FilterMenu>
                </div>
              )}
            </div>

            {page === null ? (
              <div className="text-muted-foreground flex items-center justify-center p-12">
                <Loader2 className="size-4 animate-spin" aria-hidden />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-14 text-center">
                <Search
                  className="text-muted-foreground mb-2 size-6"
                  aria-hidden
                />
                <p className="text-lg font-semibold">
                  {t("adminIssues.noResults")}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("adminIssues.noResultsHint")}
                </p>
              </div>
            ) : (
              <ul>
                {items.map((issue) => {
                  const { icon: StatusIcon, tone } = STATUS_ICON[issue.status];
                  // The description is not listed; a line of it shows only when
                  // the search matched it, so it is clear why the issue is here.
                  const excerpt = words.length
                    ? snippet(issue.description, words)
                    : null;
                  return (
                    <li
                      key={issue.id}
                      className={cn(
                        "border-border hover:bg-surface-hover relative flex items-start border-b transition-colors duration-150 last:border-0",
                        selectedIds.has(issue.id) && "bg-primary-subtle",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(issue.id)}
                        onChange={() => toggleOne(issue.id)}
                        aria-label={t("adminIssues.selectIssue", {
                          title: issue.title,
                        })}
                        className="accent-primary relative z-10 mt-3.5 ml-3 size-4 shrink-0 cursor-pointer"
                      />
                      <div className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 pl-3">
                        <StatusIcon
                          className={cn("mt-0.5 size-4 shrink-0", tone)}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          {/* The title is the button; its ::after stretches over the
                              whole row so a click anywhere opens the issue, while the
                              names below sit above it and open profiles instead. */}
                          <button
                            type="button"
                            onClick={() => setSelected(issue)}
                            className="focus-visible:after:ring-ring block w-full cursor-pointer truncate text-left font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
                          >
                            <Highlight text={issue.title} words={words} />
                          </button>
                          {issue.labels.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {issue.labels.map((slug) => (
                                <LabelChip key={slug} slug={slug} />
                              ))}
                            </div>
                          ) : null}
                          {excerpt ? (
                            <p className="text-muted-foreground mt-0.5 truncate text-xs">
                              <Highlight text={excerpt} words={words} />
                            </p>
                          ) : null}
                          <p className="text-muted-foreground relative z-10 mt-0.5 flex flex-wrap items-center gap-x-1 text-xs">
                            {t("adminIssues.reportedByPrefix")}
                            <UserProfileTrigger
                              username={issue.reporter.username}
                              fullName={issue.reporter.full_name}
                              openOnHover
                              className="text-foreground text-xs font-medium"
                            />
                            · {formatDateTime(issue.created_at, locale)}
                            {issue.assignee ? (
                              <>
                                · {t("adminIssues.takenByPrefix")}
                                <UserProfileTrigger
                                  username={issue.assignee.username}
                                  fullName={issue.assignee.full_name}
                                  openOnHover
                                  className="text-foreground text-xs font-medium"
                                />
                              </>
                            ) : null}
                            {issue.resolved_at
                              ? `· ${t("issues.closedOn", { date: formatDateTime(issue.resolved_at, locale) })}`
                              : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="flex items-center gap-3">
                            {issue.attachments.length > 0 ? (
                              <span
                                className="text-muted-foreground flex items-center gap-1 text-xs"
                                title={t("adminIssues.screenshotCount", {
                                  count: issue.attachments.length,
                                })}
                              >
                                <ImageIcon className="size-3.5" aria-hidden />
                                {issue.attachments.length}
                              </span>
                            ) : null}
                            <IssueStatusBadge status={issue.status} />
                          </span>
                          <IssueStatusBar status={issue.status} compact />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {total > 0 ? (
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <p className="text-muted-foreground text-sm" aria-live="polite">
                  {t("common.showingRange", { from, to, total })}
                </p>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="issues-page-size"
                    className="text-muted-foreground text-xs"
                  >
                    {t("common.rows")}
                  </label>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setOffset(0);
                    }}
                  >
                    <SelectTrigger
                      id="issues-page-size"
                      className="h-8 w-18"
                      aria-label={t("common.rowsPerPage")}
                    >
                      <SelectValue>{pageSize}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground hidden text-xs sm:inline">
                    {t("common.pageIndicator", {
                      current: Math.floor(offset / pageSize) + 1,
                      total: Math.ceil(total / pageSize),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - pageSize))}
                    aria-label={t("common.previousPage")}
                    title={t("common.previousPage")}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={offset + pageSize >= total}
                    onClick={() => setOffset(offset + pageSize)}
                    aria-label={t("common.nextPage")}
                    title={t("common.nextPage")}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <ReportIssueDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setReloadTick((tick) => tick + 1);
        }}
      />

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected ? (
          <DialogContent
            title={selected.title}
            className="flex max-w-2xl flex-col overflow-y-hidden"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="shrink-0 space-y-3">
                <div className="flex items-start gap-3">
                  <IssueStatusBadge status={selected.status} />
                  <div className="text-muted-foreground min-w-0 space-y-0.5 text-xs">
                    <p className="flex flex-wrap items-center gap-x-1">
                      {t("adminIssues.reportedByPrefix")}
                      <UserProfileTrigger
                        username={selected.reporter.username}
                        fullName={selected.reporter.full_name}
                        className="text-foreground text-xs font-medium"
                      />
                      · {formatDateTime(selected.created_at, locale)}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1">
                      {selected.assignee ? (
                        <>
                          {t("adminIssues.takenByPrefix")}
                          <UserProfileTrigger
                            username={selected.assignee.username}
                            fullName={selected.assignee.full_name}
                            className="text-foreground text-xs font-medium"
                          />
                        </>
                      ) : (
                        t("issues.notTaken")
                      )}
                    </p>
                    {selected.resolved_at ? (
                      <p>
                        {t("issues.closedOn", {
                          date: formatDateTime(selected.resolved_at, locale),
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
                {selected.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.labels.map((slug) => (
                      <LabelChip key={slug} slug={slug} />
                    ))}
                  </div>
                ) : null}
                <IssueStatusBar status={selected.status} />
                {!selected.can_set_status && selected.assignee ? (
                  <p className="text-muted-foreground text-xs">
                    {t("adminIssues.readOnlyHint")}
                  </p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
                <section
                  aria-label={t("adminIssues.detailsHeading")}
                  className="border-border bg-surface rounded-lg border"
                >
                  <h4 className="border-border bg-surface-sunken rounded-t-lg border-b px-4 py-2 text-sm font-semibold">
                    {t("adminIssues.detailsHeading")}
                  </h4>
                  <div className="space-y-3 p-4">
                    {selected.description ? (
                      <IssueMarkdown source={selected.description} />
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t("adminIssues.noDescription")}
                      </p>
                    )}
                    <IssueScreenshots attachments={selected.attachments} />
                    {selected.page_url ? (
                      <p className="text-muted-foreground border-border border-t pt-3 text-xs break-all">
                        {t("issues.openedFrom")}{" "}
                        <a
                          href={selected.page_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:text-primary-hover rounded-sm font-medium hover:underline"
                        >
                          {selected.page_url}
                        </a>
                      </p>
                    ) : null}
                  </div>
                </section>

                <section
                  aria-label={t("adminIssues.notesHeading")}
                  className="space-y-2"
                >
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-semibold">
                      {t("adminIssues.notesHeading")}
                    </h4>
                    {selected.notes.length > 0 ? (
                      <span className="bg-surface-sunken text-muted-foreground rounded-full px-1.5 text-[11px] font-medium">
                        {selected.notes.length}
                      </span>
                    ) : null}
                    <InfoHint label={t("adminIssues.notesHint")} />
                  </div>
                  {selected.notes.length > 0 ? (
                    <ul className="space-y-1.5">
                      {selected.notes.map((note) => (
                        <li
                          key={note.id}
                          className="border-border bg-surface rounded-lg border px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 text-xs">
                            {note.author ? (
                              <UserProfileTrigger
                                username={note.author.username}
                                fullName={note.author.full_name}
                                className="text-xs font-medium"
                              />
                            ) : (
                              <span className="font-medium">
                                {t("adminIssues.unknownAuthor")}
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {formatDateTime(note.created_at, locale)}
                            </span>
                            {note.public ? (
                              <Badge variant="info">
                                {t("adminIssues.noteShared")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
                            {note.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex items-end gap-2">
                    <Textarea
                      aria-label={t("adminIssues.addNoteLabel")}
                      value={noteDraft}
                      maxLength={2000}
                      rows={1}
                      className="min-h-9 flex-1 resize-y"
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder={t("adminIssues.addNotePlaceholder")}
                    />
                    <Hint label={t("adminIssues.addNoteTip")}>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || !noteDraft.trim()}
                        onClick={() => void addNote(selected)}
                      >
                        <StickyNote /> {t("adminIssues.addNote")}
                      </Button>
                    </Hint>
                  </div>
                </section>
              </div>

              {closingFor === selected.id ? (
                <section
                  aria-label={t("adminIssues.closingHeading")}
                  className="shrink-0 space-y-2"
                >
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-semibold">
                      {t("adminIssues.closingHeading")}
                    </h4>
                    <InfoHint label={t("adminIssues.closingHint")} />
                  </div>
                  <Textarea
                    aria-label={t("adminIssues.closingNoteLabel")}
                    value={closingNote}
                    maxLength={2000}
                    rows={3}
                    autoFocus
                    className="resize-none"
                    onChange={(event) => setClosingNote(event.target.value)}
                    placeholder={t("adminIssues.closingNotePlaceholder")}
                  />
                </section>
              ) : null}
            </div>
            <DialogFooter className="shrink-0">
              {closingFor === selected.id ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setClosingFor(null)}
                >
                  {t("common.cancel")}
                </Button>
              ) : (
                <Hint label={t("adminIssues.closeTip")}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSelected(null)}
                  >
                    {t("adminIssues.close")}
                  </Button>
                </Hint>
              )}
              {selected.can_claim && closingFor !== selected.id ? (
                <Hint label={t("adminIssues.claimHelp")}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void claim(selected)}
                  >
                    <Hand /> {t("adminIssues.claim")}
                  </Button>
                </Hint>
              ) : null}
              {selected.can_set_status && selected.status !== "done" ? (
                <Hint
                  label={t(
                    closingFor === selected.id
                      ? "adminIssues.confirmMarkDoneTip"
                      : "adminIssues.markDoneTip",
                  )}
                >
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      closingFor === selected.id
                        ? void closeIssue(selected)
                        : setClosingFor(selected.id)
                    }
                  >
                    <Check />{" "}
                    {closingFor === selected.id
                      ? t("adminIssues.confirmMarkDone")
                      : t("adminIssues.markDone")}
                  </Button>
                </Hint>
              ) : null}
              {selected.can_set_status && selected.status === "done" ? (
                <Hint label={t("adminIssues.reopenTip")}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void setStatus(selected, "in_progress")}
                  >
                    <RotateCcw /> {t("adminIssues.reopen")}
                  </Button>
                </Hint>
              ) : null}
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
