import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { ApiError, api } from "@/lib/api-client";

const { push, toastSuccess, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("next/dynamic", () => ({
  // Run the loader too, as the real one does when a draft first needs the editor.
  default: (load: () => Promise<unknown>) => {
    void Promise.resolve(load()).catch(() => undefined);
    return function Preview({ content }: { content: string }) {
      return <div data-testid="draft-preview">{content}</div>;
    };
  },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.post.mockResolvedValue({ title: "Runbook", slug: "run book" });
});

async function openDialog(
  actor: ReturnType<typeof userEvent.setup>,
  name: RegExp | string = "Create page",
) {
  await actor.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("CreatePageDialog", () => {
  it("describes a top-level page and keeps Create disabled without a title", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    expect(
      within(dialog).getByText("Add a top-level page to this space."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create page" }),
    ).toBeDisabled();
    await actor.type(within(dialog).getByLabelText("Title"), "   ");
    expect(
      within(dialog).getByRole("button", { name: "Create page" }),
    ).toBeDisabled();
  });

  it("creates a page, closes and opens it", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "  Runbook  ");
    await actor.type(within(dialog).getByLabelText(/content/i), "Hello");
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/run%20book"),
    );
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages", {
      title: "Runbook",
      content: "Hello",
      parent_id: null,
    });
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("creates a child page under its parent", async () => {
    const actor = userEvent.setup();
    render(
      <CreatePageDialog
        spaceKey="ENG"
        parentPage={{ id: "parent-1", title: "Handbook" }}
        triggerLabel=""
      />,
    );
    const dialog = await openDialog(actor, "New page");
    expect(within(dialog).getByText(/Handbook/)).toBeInTheDocument();
    await actor.type(within(dialog).getByLabelText("Title"), "Child");
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      parent_id: "parent-1",
    });
  });

  it("shows the server's message, or a generic one, and lets the user retry", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "Dup");

    mocked.post.mockRejectedValueOnce(
      new ApiError(409, "dup", "Title already exists."),
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Title already exists."),
    );

    mocked.post.mockRejectedValueOnce(new Error("network"));
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(push).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: "Create page" }),
    ).toBeEnabled();
  });

  it("ignores submitting an empty title with the keyboard", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "{Enter}");
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

describe("CreatePageDialog with AI", () => {
  const CLEAR = { questions: [], related: [] };
  const DRAFT = {
    title: "Restart the worker",
    content:
      '<div data-type="callout"><p>This page was drafted by AI.</p></div><h2>Steps</h2>',
  };

  async function withAi(enabled: boolean) {
    vi.resetModules();
    mocked.get.mockResolvedValue({ enabled, can_configure: false });
    const { CreatePageDialog: Fresh } =
      await import("@/components/pages/create-page-dialog");
    const { api: freshApi } = await import("@/lib/api-client");
    return { Fresh, freshApi: vi.mocked(freshApi) };
  }

  it("shows the set-up message in the Write with AI tab while the assistant is off", async () => {
    const { Fresh } = await withAi(false);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);

    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );

    expect(
      within(dialog).getByText(/administrator needs to connect an AI service/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Draft a whole page from a description"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("link", { name: "Open AI settings" }),
    ).toBeNull();
    expect(
      within(dialog).queryByLabelText("Describe the page you want"),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Create page" }),
    ).toBeDisabled();

    await actor.click(within(dialog).getByRole("button", { name: "Write" }));
    expect(within(dialog).getByLabelText("Content")).toBeInTheDocument();
  });

  it("offers an administrator the AI settings from that tab", async () => {
    vi.resetModules();
    mocked.get.mockResolvedValue({ enabled: false, can_configure: true });
    const { CreatePageDialog: Fresh } =
      await import("@/components/pages/create-page-dialog");
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);

    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );

    expect(
      within(dialog).getByText("Open Administration → AI assistant"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Open AI settings" }),
    ).toHaveAttribute("href", "/admin/ai");
  });

  it("drafts a page from a description, fills the title and saves the draft on Create", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post
      .mockResolvedValueOnce(CLEAR)
      .mockResolvedValueOnce(DRAFT)
      .mockResolvedValueOnce({ title: "Restart the worker", slug: "restart" });
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);

    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "how to restart the worker",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(
      await within(dialog).findByTestId("draft-preview"),
    ).toHaveTextContent("drafted by AI");
    expect(freshApi.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/ai/spaces/ENG/pages/clarify",
      {
        prompt: "how to restart the worker",
        title: "",
        lang: "en",
        mode: "deep",
        answers: [],
        related_ids: [],
      },
    );
    expect(freshApi.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/ai/spaces/ENG/pages/draft",
      {
        prompt: "how to restart the worker",
        title: "",
        lang: "en",
        answers: [],
        related_ids: [],
        detail: "detailed",
      },
    );
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Restart the worker",
    );
    expect(within(dialog).queryByLabelText(/^content$/i)).toBeNull();

    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );
    await waitFor(() =>
      expect(freshApi.post).toHaveBeenNthCalledWith(
        3,
        "/api/v1/spaces/ENG/pages",
        {
          title: "Restart the worker",
          content: DRAFT.content,
          parent_id: null,
        },
      ),
    );
  });

  it("keeps a typed title, reports a failure and lets the draft be discarded", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post
      .mockRejectedValueOnce(
        new ApiError(503, "x", "The AI assistant is not enabled."),
      )
      .mockResolvedValueOnce(CLEAR)
      .mockResolvedValueOnce(DRAFT);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "Mine");

    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "something useful",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The AI assistant is not enabled.",
    );
    expect(within(dialog).queryByTestId("draft-preview")).toBeNull();

    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));
    await within(dialog).findByTestId("draft-preview");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Mine");

    await actor.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(within(dialog).queryByTestId("draft-preview")).toBeNull();
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue("something useful");

    await actor.click(within(dialog).getByRole("button", { name: "Write" }));
    expect(within(dialog).getByLabelText("Content")).toBeInTheDocument();
  });

  it("opens the draft in a larger preview on top, leaving the form as it was", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post.mockResolvedValueOnce(CLEAR).mockResolvedValueOnce(DRAFT);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    expect(
      within(dialog).queryByRole("button", { name: "Enlarge preview" }),
    ).toBeNull();
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "something useful",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));
    await within(dialog).findByTestId("draft-preview");

    await actor.click(
      within(dialog).getByRole("button", { name: "Enlarge preview" }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2),
    );
    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    expect(within(dialogs[1]).getByTestId("draft-preview")).toHaveTextContent(
      "drafted by AI",
    );

    await actor.click(
      within(dialogs[1]).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue("something useful");
  });

  it("drafts straight from what was typed in Write, without an empty form", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post.mockResolvedValueOnce(CLEAR).mockResolvedValueOnce(DRAFT);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.click(within(dialog).getByRole("button", { name: "Write" }));
    await actor.type(within(dialog).getByLabelText("Content"), "Grafana guide");

    await actor.click(
      within(dialog).getByRole("button", { name: "Draft it with AI" }),
    );

    await within(dialog).findByTestId("draft-preview");
    expect(freshApi.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/pages/draft",
      {
        prompt: "Grafana guide",
        title: "",
        lang: "en",
        answers: [],
        related_ids: [],
        detail: "detailed",
      },
    );
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue("Grafana guide");
  });

  it("interviews adaptively in deep mode, keeps answers separate, and supports preview refinement", async () => {
    const { Fresh, freshApi } = await withAi(true);
    const q1 = {
      done: false,
      summary: "Clarifying target audience first.",
      max_questions: 10,
      questions: [
        {
          header: "Audience",
          question: "Who is it for?",
          rationale: "Controls how much background context is included.",
          multi_select: false,
          options: [
            { label: "New joiners", description: "No background", recommended: true },
            { label: "Operators", description: "Daily use" },
          ],
        },
      ],
      related: [
        {
          id: "p1",
          title: "Prometheus setup",
          slug: "prom",
          space_key: "OPS",
          space_name: "Ops",
        },
      ],
    };
    const q2 = {
      done: false,
      summary: "Audience settled; clarifying sections.",
      max_questions: 10,
      questions: [
        {
          header: "Parts",
          question: "Which parts?",
          multi_select: true,
          options: [
            { label: "Setup", description: "" },
            { label: "Alerts", description: "" },
          ],
        },
      ],
      related: q1.related,
    };
    const doneClarify = {
      done: true,
      summary: "All branches settled.",
      max_questions: 10,
      questions: [],
      related: q1.related,
    };
    const draftWithMd = { ...DRAFT, markdown: "## Steps\n\n1. Do it." };
    const refinedDraft = {
      title: "Restart the worker",
      content: '<div data-type="callout"><p>Refined</p></div>',
      markdown: "## Steps\n\n1. Do it.\n2. Verify.",
    };

    freshApi.post
      .mockResolvedValueOnce(q1)
      .mockResolvedValueOnce(q2)
      .mockResolvedValueOnce(doneClarify)
      .mockResolvedValueOnce(draftWithMd)
      .mockResolvedValueOnce(refinedDraft);

    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Grafana guide",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(
      await within(dialog).findByText("Who is it for?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Question 1 (up to 10)"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
    await actor.click(within(dialog).getByRole("radio", { name: /Operators/ }));
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));

    // Right-hand "Decisions so far" shows the settled answer while Q2 appears.
    expect(
      await within(dialog).findByText("Which parts?"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 settled")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("checkbox", { name: /Setup/ }));
    await actor.click(within(dialog).getByRole("checkbox", { name: /Alerts/ }));
    await actor.type(
      within(dialog).getByLabelText("Or write your own answer"),
      "Docker",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));

    await within(dialog).findByTestId("draft-preview");
    expect(freshApi.post).toHaveBeenNthCalledWith(
      4,
      "/api/v1/ai/spaces/ENG/pages/draft",
      {
        prompt: "Grafana guide",
        title: "",
        lang: "en",
        answers: [
          {
            header: "Audience",
            question: "Who is it for?",
            answer: "Operators",
          },
          {
            header: "Parts",
            question: "Which parts?",
            answer: "Setup, Alerts, Docker",
          },
        ],
        related_ids: ["p1"],
        detail: "detailed",
      },
    );
    // Original prompt stays clean and uncorrupted.
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue("Grafana guide");

    // Refine preview directly from the refine bar (via Enter key) and handle error + Regenerate.
    await actor.type(
      within(dialog).getByLabelText(/Ask AI to refine this draft/),
      "Add verification step{Enter}",
    );
    await waitFor(() =>
      expect(within(dialog).getByTestId("draft-preview")).toHaveTextContent(
        "Refined",
      ),
    );
    expect(freshApi.post).toHaveBeenNthCalledWith(
      5,
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({
        previous_draft: "## Steps\n\n1. Do it.",
        revision_instruction: "Add verification step",
      }),
    );

    // Refine error shows alert while keeping the preview.
    freshApi.post.mockRejectedValueOnce(new ApiError(500, "x", "Refine failed."));
    await actor.type(
      within(dialog).getByLabelText(/Ask AI to refine this draft/),
      "Try again",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Refine" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Refine failed.",
    );

    // Regenerate reuses settled answers without re-interviewing.
    freshApi.post.mockResolvedValueOnce(DRAFT);
    await actor.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(freshApi.post).toHaveBeenCalledTimes(7));
    expect(freshApi.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({ related_ids: ["p1"] }),
    );
  });

  it("supports Back, Rewind, Continue grilling, Clear decisions, and error rollback in deep mode", async () => {
    const { Fresh, freshApi } = await withAi(true);
    const q1 = {
      done: false,
      summary: "Step 1",
      max_questions: 10,
      questions: [
        {
          header: "",
          question: "Q1?",
          multi_select: false,
          options: [
            { label: "A", description: "" },
            { label: "B", description: "" },
          ],
        },
      ],
      related: [
        {
          id: "p1",
          title: "Existing guide",
          slug: "existing",
          space_key: "ENG",
          space_name: "Engineering",
        },
      ],
    };
    const q2 = {
      done: false,
      summary: "Step 2",
      max_questions: 10,
      questions: [
        {
          header: "OS",
          question: "Q2?",
          multi_select: false,
          options: [
            { label: "Win10", description: "" },
            { label: "Win11", description: "" },
          ],
        },
      ],
      related: q1.related,
    };

    freshApi.post
      .mockResolvedValueOnce(q1)
      .mockResolvedValueOnce(q1)
      .mockRejectedValueOnce(new ApiError(500, "x", "Next question failed."))
      .mockResolvedValueOnce(q2)
      .mockResolvedValueOnce(q2)
      .mockResolvedValueOnce(DRAFT)
      .mockRejectedValueOnce(new ApiError(500, "x", "Continue failed."))
      .mockResolvedValueOnce(q2)
      .mockResolvedValueOnce(DRAFT)
      .mockResolvedValueOnce({ done: true, questions: [], related: q1.related })
      .mockResolvedValueOnce(DRAFT);

    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Windows setup",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    // Back on Q1 returns to the prompt and reveals Found in the wiki on the right.
    expect(await within(dialog).findByText("Q1?")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByText("Found in the wiki")).toBeInTheDocument();
    expect(within(dialog).getByText("Existing guide")).toBeInTheDocument();

    // Resume Q1; simulate clarify failure rollback, then succeed to Q2.
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));
    expect(await within(dialog).findByText("Q1?")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("radio", { name: "A" }));
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Next question failed.",
    );

    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Q2?")).toBeInTheDocument();

    // Test Back to Q1, re-answer Q1 -> Q2, then Rewind via pencil button in Decisions.
    await actor.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByText("Q1?")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("radio", { name: "B" }));
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Q2?")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Edit answer" }));
    expect(within(dialog).getByText("Q1?")).toBeInTheDocument();

    // Select A on Q1 and click "Enough, write now" with selection.
    await actor.click(within(dialog).getByRole("radio", { name: "A" }));
    await actor.click(
      within(dialog).getByRole("button", { name: "Enough, write now" }),
    );
    await within(dialog).findByTestId("draft-preview");
    expect(within(dialog).getByText("1 settled")).toBeInTheDocument();

    // Discard draft, test Continue grilling error, resuming Q2 -> Enough, write now, Quick hiding Continue grilling, Continue grilling done:true -> drafts, and Clear.
    await actor.click(within(dialog).getByRole("button", { name: "Discard" }));
    await actor.click(
      within(dialog).getByRole("button", { name: "Continue grilling" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Continue failed.",
    );

    await actor.click(
      within(dialog).getByRole("button", { name: "Continue grilling" }),
    );
    expect(await within(dialog).findByText("Q2?")).toBeInTheDocument();
    await actor.click(
      within(dialog).getByRole("button", { name: "Enough, write now" }),
    );
    await within(dialog).findByTestId("draft-preview");

    await actor.click(within(dialog).getByRole("button", { name: "Discard" }));
    await actor.click(within(dialog).getByRole("button", { name: "Quick" }));
    expect(
      within(dialog).queryByRole("button", { name: "Continue grilling" }),
    ).toBeNull();
    await actor.click(
      within(dialog).getByRole("button", { name: "Deep (Grill-me)" }),
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Continue grilling" }),
    );
    await within(dialog).findByTestId("draft-preview");

    await actor.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(within(dialog).queryByText("1 settled")).toBeNull();
  });

  it("lets the author stop grilling early with Enough, write now and supports Quick mode", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post
      .mockResolvedValueOnce({
        done: false,
        questions: [
          {
            header: "",
            question: "Who is it for?",
            multi_select: false,
            options: [
              { label: "A", description: "" },
              { label: "B", description: "" },
            ],
          },
        ],
        related: [],
      })
      .mockResolvedValueOnce(DRAFT)
      .mockResolvedValueOnce(DRAFT);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Grafana guide",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));
    await actor.click(
      await within(dialog).findByRole("button", { name: "Enough, write now" }),
    );

    await within(dialog).findByTestId("draft-preview");
    expect(freshApi.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({ answers: [] }),
    );

    // Quick mode skips clarify completely and respects selected Brief detail level.
    await actor.click(within(dialog).getByRole("button", { name: "Discard" }));
    await actor.click(within(dialog).getByRole("button", { name: "Quick" }));
    await actor.click(within(dialog).getByRole("button", { name: "Brief" }));
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(freshApi.post).toHaveBeenCalledTimes(3));
    expect(freshApi.post).toHaveBeenNthCalledWith(
      3,
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({ detail: "brief" }),
    );
  });

  it("explains a missing AI route instead of a bare Not Found", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post.mockRejectedValueOnce(
      new ApiError(404, "not_found", "Not Found"),
    );
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Grafana guide",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/not available on the server yet/);
    expect(alert).not.toHaveTextContent(/^Not Found$/);
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "!",
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it.each([
    ["a server message", new ApiError(500, "x", "The model is busy."), "The model is busy."],
    ["an empty server message", new ApiError(500, "x", ""), "The AI assistant could not write this page right now."],
    ["a failure that is not the server's", new Error("boom"), "The AI assistant could not write this page right now."],
  ])("explains %s on the page", async (_label, failure, text) => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post.mockRejectedValueOnce(failure);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Grafana guide",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(text);
  });

  it("fills in the description from a suggestion chip", async () => {
    const { Fresh } = await withAi(true);
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );

    const chips = within(dialog)
      .getAllByRole("button")
      .filter((button) => button.className.includes("rounded-full"));
    expect(chips).toHaveLength(4);
    await actor.click(chips[0]);

    expect(within(dialog).getByLabelText("Describe the page you want")).not.toHaveValue("");
    expect(within(dialog).getByLabelText("Describe the page you want")).toHaveFocus();
  });

  it("explains a draft that fails after the questions were settled", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post
      .mockResolvedValueOnce(CLEAR)
      .mockRejectedValueOnce(new ApiError(500, "x", "The draft failed."));
    const actor = userEvent.setup();
    render(<Fresh spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.click(
      await within(dialog).findByRole("button", { name: "Write with AI" }),
    );
    await actor.type(
      within(dialog).getByLabelText("Describe the page you want"),
      "Grafana guide",
    );
    await actor.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The draft failed.");
  });
});
