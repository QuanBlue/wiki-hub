import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { AiQuestionsPanel } from "@/components/admin/ai-questions-panel";
import { AnswerFeedback } from "@/components/chat/answer-feedback";
import { api } from "@/lib/api-client";
import { filterQuestions, sortedReasons } from "@/lib/question-gaps";
import type { QuestionGroup, QuestionGroupList } from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const KEY = "a".repeat(32);
const OTHER = "b".repeat(32);
const now = new Date().toISOString();

function group(extra: Partial<QuestionGroup> = {}): QuestionGroup {
  return {
    key: KEY,
    question: "How many leave days?",
    standalone: null,
    variants: ["How many leave days?", "how many leave days"],
    count: 3,
    askers: [
      { id: "u1", username: "lan", name: "Lan Tran" },
      { id: "u2", username: "minh", name: "Minh Le" },
    ],
    first_asked_at: now,
    last_asked_at: now,
    reasons: ["not_in_pages", "no_match"],
    surfaces: ["chat"],
    near_pages: [{ id: "p1", title: "Leave policy", slug: "leave-policy", space_key: "HR" }],
    answer_excerpt: null,
    resolution: null,
    resolved_at: null,
    answer_page: null,
    ...extra,
  };
}

function listOf(items: QuestionGroup[], recording = true): QuestionGroupList {
  return { items, recording, retention_days: 90 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("question helpers", () => {
  it("filters by any wording or asker, and orders reasons by how telling they are", () => {
    const groups = [
      group(),
      group({ key: OTHER, question: "VPN?", variants: ["VPN?"], askers: [] }),
    ];
    expect(filterQuestions(groups, "")).toHaveLength(2);
    expect(filterQuestions(groups, "LEAVE").map((g) => g.key)).toEqual([KEY]);
    expect(filterQuestions(groups, "minh").map((g) => g.key)).toEqual([KEY]);
    expect(filterQuestions(groups, "vpn").map((g) => g.key)).toEqual([OTHER]);
    expect(sortedReasons({ reasons: ["web", "disliked", "no_match"] })).toEqual([
      "no_match",
      "disliked",
      "web",
    ]);
  });
});

describe("AiQuestionsPanel", () => {
  it("lists each question once with how often, who asked and the pages that came close", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([group()]));
    render(<AiQuestionsPanel />);

    expect(await screen.findByText("How many leave days?")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/v1/ai/questions?status=open");
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText(/Asked by Lan Tran, Minh Le/)).toBeInTheDocument();
    expect(screen.getByText(/Also asked as “how many leave days”/)).toBeInTheDocument();
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
    expect(screen.getByText("Pages don’t say")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leave policy" })).toHaveAttribute(
      "href",
      "/spaces/HR/pages/leave-policy",
    );
    expect(screen.getByRole("switch", { name: "Record questions" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("dismisses a question and takes it off the list", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([group()]));
    vi.mocked(api.post).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(api.post).toHaveBeenCalledWith(`/api/v1/ai/questions/${KEY}/resolve`, {
      resolution: "dismissed",
      space_key: null,
      slug: null,
    });
    expect(await screen.findByText("No unanswered questions")).toBeInTheDocument();
  });

  it("marks a question answered by a page found by searching", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.startsWith("/api/v1/search")
        ? {
            query: "leave",
            spaces: [],
            pages: [
              {
                id: "p9",
                title: "Annual leave",
                slug: "annual-leave",
                space_key: "HR",
                space_name: "People",
                snippet: "",
                updated_at: null,
              },
            ],
          }
        : listOf([group()]),
    );
    vi.mocked(api.post).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("button", { name: "Mark answered" }));
    const dialog = await screen.findByRole("dialog");
    await actor.type(within(dialog).getByLabelText("Search for the page that answers it"), "leave");
    await actor.click(await within(dialog).findByRole("button", { name: /Annual leave/ }));
    await actor.click(within(dialog).getByRole("button", { name: "Mark answered and notify" }));

    expect(api.post).toHaveBeenCalledWith(`/api/v1/ai/questions/${KEY}/resolve`, {
      resolution: "answered",
      space_key: "HR",
      slug: "annual-leave",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("No unanswered questions")).toBeInTheDocument();
  });

  it("asks before deleting a question", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([group()]));
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("the 3 times it was asked");
    expect(api.delete).not.toHaveBeenCalled();
    await actor.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(api.delete).toHaveBeenCalledWith(`/api/v1/ai/questions/${KEY}`);
  });

  it("shows resolved questions, which can be reopened", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.endsWith("status=resolved")
        ? listOf([
            group({
              resolution: "answered",
              resolved_at: now,
              answer_page: { id: "p9", title: "Annual leave", slug: "annual-leave", space_key: "HR" },
            }),
          ])
        : listOf([]),
    );
    vi.mocked(api.post).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("tab", { name: "Resolved" }));
    expect(await screen.findByRole("link", { name: "Annual leave" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Reopen" }));

    expect(api.post).toHaveBeenCalledWith(`/api/v1/ai/questions/${KEY}/reopen`);
  });

  it("turns recording off", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([]));
    vi.mocked(api.put).mockResolvedValue({ enabled: false });
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    const toggle = await screen.findByRole("switch", { name: "Record questions" });
    await actor.click(toggle);

    expect(api.put).toHaveBeenCalledWith("/api/v1/ai/questions/recording", { enabled: false });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("says when recording is off and nothing is listed", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([], false));
    render(<AiQuestionsPanel />);

    expect(await screen.findByText(/Recording is off/)).toBeInTheDocument();
  });

  it("filters the list", async () => {
    vi.mocked(api.get).mockResolvedValue(
      listOf([group(), group({ key: OTHER, question: "VPN?", variants: ["VPN?"] })]),
    );
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.type(await screen.findByLabelText("Filter by question or person"), "vpn");

    expect(screen.getByText("VPN?")).toBeInTheDocument();
    expect(screen.queryByText("How many leave days?")).not.toBeInTheDocument();
    await actor.clear(screen.getByLabelText("Filter by question or person"));
    await actor.type(screen.getByLabelText("Filter by question or person"), "zzz");
    expect(screen.getByText("No question matches “zzz”.")).toBeInTheDocument();
  });

  it("offers to try again when the list cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down")).mockResolvedValue(listOf([]));
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No unanswered questions")).toBeInTheDocument();
  });
});

describe("AiQuestionsPanel, less common cases", () => {
  it("shows a follow-up as understood, an unhelpful answer, and a dismissed question", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.endsWith("status=resolved")
        ? listOf([group({ resolution: "dismissed", resolved_at: null, answer_page: null })])
        : listOf([
            group({
              standalone: "how many annual leave days",
              reasons: ["disliked", "web"],
              answer_excerpt: "Twelve days.",
              near_pages: [],
            }),
          ]),
    );
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    expect(
      await screen.findByText(/Understood as: “how many annual leave days”/),
    ).toBeInTheDocument();
    expect(screen.getByText("Marked unhelpful")).toBeInTheDocument();
    expect(screen.getByText("From the internet")).toBeInTheDocument();
    expect(screen.getByText(/Twelve days\./)).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: "Resolved" }));
    expect(await screen.findByText("Dismissed")).toBeInTheDocument();
  });

  it("reports a failed action and keeps the question", async () => {
    vi.mocked(api.get).mockResolvedValue(listOf([group()]));
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    vi.mocked(api.delete).mockRejectedValue(new Error("down"));
    vi.mocked(api.put).mockRejectedValue(new Error("down"));
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    await actor.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    await actor.click(screen.getByRole("button", { name: "Mark answered" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Mark answered" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    await actor.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await actor.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    await actor.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3));
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: "Record questions" });
    await actor.click(toggle);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(4));
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("How many leave days?")).toBeInTheDocument();
  });

  it("marks answered without a page, and closes the picker with Escape", async () => {
    let finishSearch!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.startsWith("/api/v1/search")
        ? new Promise((resolve, reject) => {
            finishSearch = (value) => (value instanceof Error ? reject(value) : resolve(value));
          })
        : Promise.resolve(
            listOf([group(), group({ key: OTHER, question: "VPN?", variants: ["VPN?"] })]),
          ),
    );
    vi.mocked(api.post).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AiQuestionsPanel />);

    const [first] = await screen.findAllByRole("button", { name: "Mark answered" });
    await actor.click(first!);
    let dialog = await screen.findByRole("dialog");
    await actor.type(within(dialog).getByLabelText("Search for the page that answers it"), "zz");
    expect(await within(dialog).findByText("Searching…")).toBeInTheDocument();
    finishSearch(new Error("search down"));
    expect(await within(dialog).findByText("No page found.")).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const [again] = screen.getAllByRole("button", { name: "Mark answered" });
    await actor.click(again!);
    dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Mark answered" }));

    expect(api.post).toHaveBeenCalledWith(`/api/v1/ai/questions/${KEY}/resolve`, {
      resolution: "answered",
      space_key: null,
      slug: null,
    });
    await waitFor(() =>
      expect(screen.queryByText("How many leave days?")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("VPN?")).toBeInTheDocument();
  });
});

describe("AnswerFeedback", () => {
  it("sends the question and answer once, then thanks", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(
      <AnswerFeedback surface="chat" question="Which VPN?" answer="vpn1" pageIds={["p1"]} />,
    );

    await actor.click(screen.getByRole("button", { name: "Not helpful" }));

    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/feedback", {
      surface: "chat",
      question: "Which VPN?",
      answer: "vpn1",
      page_ids: ["p1"],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("the administrators will see");
    expect(screen.queryByRole("button", { name: "Not helpful" })).not.toBeInTheDocument();
  });

  it("says when it could not be sent, and can be tried again", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<AnswerFeedback surface="search" question="Q" answer="A" pageIds={[]} />);

    await actor.click(screen.getByRole("button", { name: "Not helpful" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not send");
    await actor.click(screen.getByRole("button", { name: "Not helpful" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("shows nothing without a question", () => {
    const { container } = render(
      <AnswerFeedback surface="chat" question="  " answer="A" pageIds={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
