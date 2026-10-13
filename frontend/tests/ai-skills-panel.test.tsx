import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { AiSkillsPanel } from "@/components/admin/ai-skills-panel";
import { api } from "@/lib/api-client";
import type { AiSkill } from "@/lib/admin-ai";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const URL = "/api/v1/ai/skills/summary";
const DEFAULT = "Write a TL;DR of the wiki page.";

const builtIn: AiSkill = {
  instructions: "",
  default_instructions: DEFAULT,
  is_custom: false,
};
const custom: AiSkill = {
  ...builtIn,
  instructions: "Summarise as a haiku.",
  is_custom: true,
};

function card() {
  return within(screen.getByRole("article"));
}

async function openView(article = card()) {
  await userEvent.click(article.getByRole("button"));
  return within(await screen.findByRole("dialog"));
}

async function openEdit(article = card()) {
  const view = await openView(article);
  await userEvent.click(view.getByRole("button", { name: "Edit" }));
  return within(await screen.findByRole("dialog"));
}

beforeEach(() => {
  vi.mocked(api.put).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("AiSkillsPanel cards", () => {
  it("shows only the name and a short description, not the instructions", () => {
    render(<AiSkillsPanel initialSummary={builtIn} />);

    expect(card().getByText("Page summary (TL;DR)")).toBeInTheDocument();
    expect(card().getByText("Default")).toBeInTheDocument();
    expect(card().getByText("How a page is summarized.")).toBeInTheDocument();
    expect(card().queryByText(DEFAULT)).toBeNull();
    expect(card().getAllByRole("button")).toHaveLength(1);
  });

  it("marks a customised skill with a Custom badge", () => {
    render(<AiSkillsPanel initialSummary={custom} />);

    expect(card().getByText("Custom")).toBeInTheDocument();
    expect(card().queryByText("Summarise as a haiku.")).toBeNull();
  });
});

describe("AiSkillsPanel view", () => {
  it("reads the instructions in full without any way to change them", async () => {
    render(<AiSkillsPanel initialSummary={custom} />);

    const dialog = await openView();

    expect(dialog.getByLabelText("Instructions")).toHaveTextContent(
      "Summarise as a haiku.",
    );
    expect(dialog.queryByRole("textbox")).toBeNull();
    expect(
      dialog.getByText(/replies are shown as Markdown/),
    ).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("goes from viewing to editing", async () => {
    render(<AiSkillsPanel initialSummary={builtIn} />);

    const view = await openView();
    await userEvent.click(view.getByRole("button", { name: "Edit" }));

    expect(
      await within(screen.getByRole("dialog")).findByRole("textbox"),
    ).toHaveValue(DEFAULT);
  });
});

describe("AiSkillsPanel edit", () => {
  it("starts from the built-in wording so it can be tweaked, and saves only a real change", async () => {
    vi.mocked(api.put).mockResolvedValue(custom);
    render(<AiSkillsPanel initialSummary={builtIn} />);

    const dialog = await openEdit();
    const box = dialog.getByRole("textbox", { name: "Instructions" });
    expect(box).toHaveValue(DEFAULT);
    expect(dialog.getByRole("button", { name: "Save skill" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Use default" })).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, "Summarise as a haiku.");
    expect(dialog.getByText("21 / 4000")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(URL, {
        instructions: "Summarise as a haiku.",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Skill saved.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The card reflects the saved skill.
    expect(card().getByText("Custom")).toBeInTheDocument();
  });

  it("goes back to the default with Use default", async () => {
    vi.mocked(api.put).mockResolvedValue(builtIn);
    render(<AiSkillsPanel initialSummary={custom} />);

    const dialog = await openEdit();
    expect(dialog.getByRole("textbox", { name: "Instructions" })).toHaveValue(
      "Summarise as a haiku.",
    );
    await userEvent.click(dialog.getByRole("button", { name: "Use default" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(URL, { instructions: "" }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Back to the default instructions.",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card().getByText("Default")).toBeInTheDocument();
  });

  it("treats the built-in wording typed back in as the default", async () => {
    vi.mocked(api.put).mockResolvedValue(builtIn);
    render(<AiSkillsPanel initialSummary={custom} />);

    const dialog = await openEdit();
    const box = dialog.getByRole("textbox", { name: "Instructions" });
    await userEvent.clear(box);
    await userEvent.type(box, DEFAULT);
    await userEvent.click(dialog.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(URL, { instructions: "" }),
    );
  });

  it("cannot save an empty skill, and cancelling changes nothing", async () => {
    render(<AiSkillsPanel initialSummary={custom} />);

    const dialog = await openEdit();
    await userEvent.clear(
      dialog.getByRole("textbox", { name: "Instructions" }),
    );
    expect(dialog.getByRole("button", { name: "Save skill" })).toBeDisabled();

    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
    expect(card().getByText("Custom")).toBeInTheDocument();
  });

  it("reports a failed save and keeps the dialog and what was typed", async () => {
    vi.mocked(api.put).mockRejectedValue(new Error("down"));
    render(<AiSkillsPanel initialSummary={builtIn} />);

    const dialog = await openEdit();
    const box = dialog.getByRole("textbox", { name: "Instructions" });
    await userEvent.clear(box);
    await userEvent.type(box, "Be brief.");
    await userEvent.click(dialog.getByRole("button", { name: "Save skill" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dialog.getByRole("textbox", { name: "Instructions" })).toHaveValue(
      "Be brief.",
    );
    expect(dialog.getByRole("button", { name: "Save skill" })).toBeEnabled();
  });
});

describe("AiSkillsPanel page-draft card", () => {
  const draftDefault = "Write a first draft of a wiki page.";
  const draftSkill: AiSkill = {
    instructions: "",
    default_instructions: draftDefault,
    is_custom: false,
  };

  it("adds a second card for creating a page with AI", () => {
    render(
      <AiSkillsPanel initialSummary={builtIn} initialPageDraft={draftSkill} />,
    );

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(
      within(cards[1]).getByText("Create page with AI"),
    ).toBeInTheDocument();
    expect(
      within(cards[1]).getByText(
        "How a new page is drafted from a description.",
      ),
    ).toBeInTheDocument();
  });

  it("saves that skill under its own name, leaving the summary alone", async () => {
    const saved: AiSkill = {
      ...draftSkill,
      instructions: "Keep it short.",
      is_custom: true,
    };
    vi.mocked(api.put).mockResolvedValue(saved);
    render(
      <AiSkillsPanel initialSummary={builtIn} initialPageDraft={draftSkill} />,
    );

    const dialog = await openEdit(within(screen.getAllByRole("article")[1]));
    const box = dialog.getByRole("textbox", { name: "Instructions" });
    expect(box).toHaveValue(draftDefault);
    await userEvent.clear(box);
    await userEvent.type(box, "Keep it short.");
    await userEvent.click(dialog.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/skills/page-draft", {
        instructions: "Keep it short.",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      within(screen.getAllByRole("article")[1]).getByText("Custom"),
    ).toBeInTheDocument();
    expect(
      within(screen.getAllByRole("article")[0]).getByText("Default"),
    ).toBeInTheDocument();
  });
});
