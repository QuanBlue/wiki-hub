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
      { prompt: "how to restart the worker", title: "", lang: "en" },
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
      },
    );
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue("Grafana guide");
  });

  it("asks the AI's questions, then writes with the answers and the pages it found", async () => {
    const { Fresh, freshApi } = await withAi(true);
    const found = {
      questions: [
        {
          header: "Audience",
          question: "Who is it for?",
          multi_select: false,
          options: [
            { label: "New joiners", description: "No background" },
            { label: "Operators", description: "Daily use" },
          ],
        },
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
    freshApi.post.mockResolvedValueOnce(found).mockResolvedValueOnce(DRAFT);
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
    expect(within(dialog).getByText("Question 1 of 2")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
    await actor.click(within(dialog).getByRole("radio", { name: /Operators/ }));
    await actor.click(within(dialog).getByRole("button", { name: "Next" }));
    await actor.click(within(dialog).getByRole("checkbox", { name: /Setup/ }));
    await actor.click(within(dialog).getByRole("checkbox", { name: /Alerts/ }));
    await actor.type(
      within(dialog).getByLabelText("Or write your own answer"),
      "Docker",
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Write the page" }),
    );

    await within(dialog).findByTestId("draft-preview");
    const merged =
      "Grafana guide\n\n- Who is it for?: Operators\n- Which parts?: Setup, Alerts, Docker";
    expect(freshApi.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/draft",
      {
        prompt: merged,
        title: "",
        lang: "en",
        answers: [],
        related_ids: ["p1"],
      },
    );
    // The description box now holds what the draft was built from.
    expect(
      within(dialog).getByLabelText("Describe the page you want"),
    ).toHaveValue(merged);
    // Regenerating keeps the answers and does not ask again.
    freshApi.post.mockResolvedValueOnce(DRAFT);
    await actor.click(
      within(dialog).getByRole("button", { name: "Regenerate" }),
    );
    await waitFor(() => expect(freshApi.post).toHaveBeenCalledTimes(3));
    expect(freshApi.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({ related_ids: ["p1"] }),
    );
  });

  it("lets the author skip the questions", async () => {
    const { Fresh, freshApi } = await withAi(true);
    freshApi.post
      .mockResolvedValueOnce({
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
      await within(dialog).findByRole("button", { name: "Skip questions" }),
    );

    await within(dialog).findByTestId("draft-preview");
    expect(freshApi.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/draft",
      expect.objectContaining({ answers: [] }),
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
