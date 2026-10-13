import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MyIssuesPage from "@/app/issues/page";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import type { Issue, Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listMyIssues: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/issues", () => ({ listMyIssues: m.listMyIssues }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join("|")}` : key,
    locale: "en",
  }),
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/issues/issue-export-button", () => ({
  IssueExportButton: ({ issueIds }: { issueIds: string[] }) => <button>export {issueIds.join()}</button>,
}));
vi.mock("@/components/issues/report-issue-button", () => ({
  ReportIssueButton: () => <button>report</button>,
}));
vi.mock("@/components/issues/issue-screenshots", () => ({
  IssueScreenshots: ({ attachments }: { attachments: unknown[] }) => <i>shots {attachments.length}</i>,
}));
vi.mock("@/components/issues/issue-status-badge", () => ({
  IssueStatusBadge: ({ status }: { status: string }) => <b>badge {status}</b>,
  IssueStatusBar: ({ status }: { status: string }) => <u>bar {status}</u>,
}));
vi.mock("@/components/issues/label-chip", () => ({
  LabelChip: ({ slug }: { slug: string }) => <em>chip {slug}</em>,
}));

describe("IssueMarkdown", () => {
  it("renders headings, quotes, rules for each block kind", () => {
    const { container } = render(
      <IssueMarkdown
        source={[
          "# One",
          "## Two",
          "### Three",
          "> quoted **bold**",
          "> second",
          "",
          "- a",
          "* b",
          "",
          "1. first",
          "2. second",
          "",
          "- [ ] todo",
          "- [x] done",
          "",
          "plain line",
          "next line",
          "#hashtag stays text",
        ].join("\r\n")}
        className="extra"
      />,
    );

    expect(container.querySelector("h1")).toHaveTextContent("One");
    expect(container.querySelector("h2")).toHaveTextContent("Two");
    expect(container.querySelector("h3")).toHaveTextContent("Three");
    expect(container.querySelector("blockquote strong")).toHaveTextContent("bold");
    expect(container.querySelectorAll("blockquote p")).toHaveLength(2);
    expect(container.querySelectorAll("ul.list-disc li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true]);
    expect(container.querySelector("p br")).not.toBeNull();
    expect(container.textContent).toContain("#hashtag stays text");
    expect(container.firstElementChild).toHaveClass("extra");
  });

  it("renders fenced code, including an unclosed fence", () => {
    const closed = render(<IssueMarkdown source={"```\nconst a = 1;\n```\nafter"} />);
    expect(closed.container.querySelector("pre code")).toHaveTextContent("const a = 1;");
    expect(closed.container.textContent).toContain("after");
    closed.unmount();

    const open = render(<IssueMarkdown source={"```\nnever closed"} />);
    expect(open.container.querySelector("pre code")).toHaveTextContent("never closed");
  });

  it("renders inline code, bold, italic and safe links", () => {
    const { container } = render(
      <IssueMarkdown source={"use `npm i` and **bold** with _italic_ see [docs](https://example.com/a) and <b>x</b>"} />,
    );
    expect(container.querySelector("code")).toHaveTextContent("npm i");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>x</b>");
  });

  it("highlights only the mentions of known people", () => {
    const { container } = render(
      <IssueMarkdown
        source={"ping @Alice. and @bob-, not @carol, mail a@b.c"}
        mentions={["alice", "BOB"]}
      />,
    );
    const marks = Array.from(container.querySelectorAll("span.text-primary")).map((n) => n.textContent);
    expect(marks).toEqual(["@Alice", "@bob"]);
    expect(container.textContent).toContain("not @carol");
  });

  it("leaves @ text alone without mentions", () => {
    const { container } = render(<IssueMarkdown source="hi @alice" mentions={[]} />);
    expect(container.querySelector("span.text-primary")).toBeNull();
  });

  it("highlights mentions inside headings, lists and quotes", () => {
    const { container } = render(
      <IssueMarkdown source={"# hi @alice\n- @alice\n1. @alice\n> @alice"} mentions={["alice"]} />,
    );
    expect(container.querySelectorAll("span.text-primary")).toHaveLength(4);
  });
});

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    title: "Cannot save",
    description: "It **fails**.",
    status: "open",
    labels: ["bug"],
    attachments: [{}],
    notes: [],
    assignee: null,
    created_at: "2026-03-05T12:00:00Z",
    resolved_at: null,
    ...overrides,
  } as unknown as Issue;
}

async function renderPage(page?: string) {
  render(await MyIssuesPage({ searchParams: Promise.resolve({ page }) }));
}

describe("MyIssuesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCurrentUser.mockResolvedValue({ id: "me" } as Me);
    m.listMyIssues.mockResolvedValue({ items: [issue()], total: 1 });
  });

  it("sends anonymous visitors to sign in", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("redirect:/login");
  });

  it("shows an empty state", async () => {
    m.listMyIssues.mockResolvedValue({ items: [], total: 0 });
    await renderPage();
    expect(screen.getByText("issues.myEmpty")).toBeInTheDocument();
  });

  it("lists an open issue with labels, description and who has it", async () => {
    await renderPage();
    expect(screen.getByText("Cannot save")).toBeInTheDocument();
    expect(screen.getByText("badge open")).toBeInTheDocument();
    expect(screen.getByText("chip bug")).toBeInTheDocument();
    expect(screen.getByText("fails")).toBeInTheDocument();
    expect(screen.getByText("shots 1")).toBeInTheDocument();
    expect(screen.getByText("export i1")).toBeInTheDocument();
    expect(screen.getByText(/issues.notTaken/)).toBeInTheDocument();
    expect(m.listMyIssues).toHaveBeenCalledWith(20, 0);
  });

  it("shows notes, the assignee and the close date", async () => {
    m.listMyIssues.mockResolvedValue({
      items: [
        issue({
          labels: [],
          description: "",
          assignee: { full_name: "", username: "carol" },
          resolved_at: "2026-03-06T12:00:00Z",
          notes: [
            { id: "n1", body: "Looking", created_at: "2026-03-05T13:00:00Z", author: { full_name: "Dan Ng", username: "dan" } },
            { id: "n2", body: "Anon note", created_at: "2026-03-05T14:00:00Z", author: null },
          ],
        } as unknown as Partial<Issue>),
      ],
      total: 45,
    });
    await renderPage("2");

    expect(m.listMyIssues).toHaveBeenCalledWith(20, 20);
    expect(screen.getByText("Looking")).toBeInTheDocument();
    expect(screen.getByText(/issues.noteFrom:Dan Ng/)).toBeInTheDocument();
    expect(screen.getByText(/issues.noteFrom:adminIssues.unknownAuthor/)).toBeInTheDocument();
    expect(screen.getByText(/issues.takenBy:carol/)).toBeInTheDocument();
    expect(screen.getByText(/issues.closedOn/)).toBeInTheDocument();
    expect(screen.queryByText(/chip /)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1/ })).toHaveAttribute("href", "/issues");
    expect(screen.getByRole("link", { name: /3/ })).toHaveAttribute("href", "/issues?page=3");
  });

  it("falls back to the first page for a bad page number", async () => {
    await renderPage("abc");
    expect(m.listMyIssues).toHaveBeenCalledWith(20, 0);
  });

  it("names an assignee by full name when there is one", async () => {
    m.listMyIssues.mockResolvedValue({
      items: [issue({ assignee: { full_name: "Carol C", username: "carol" } } as unknown as Partial<Issue>)],
      total: 1,
    });
    await renderPage();
    expect(screen.getByText(/issues.takenBy:Carol C/)).toBeInTheDocument();
  });
});
