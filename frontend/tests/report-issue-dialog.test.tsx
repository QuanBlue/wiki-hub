import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ReportIssueDialog } from "@/components/issues/report-issue-dialog";
import { api } from "@/lib/api-client";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const DRAFT_KEY = "wikihub:issue-draft";
const PNG = () => new File(["png-bytes"], "shot.png", { type: "image/png" });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  window.localStorage.removeItem(DRAFT_KEY);
  vi.mocked(api.post).mockReset().mockResolvedValue({ id: "new-issue" });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(DRAFT_KEY);
});

const title = () => screen.getByLabelText(/^Add a title/u);
const description = () => screen.getByLabelText("Add a description");

describe("ReportIssueDialog drafts", () => {
  it.each([
    ["is not JSON", "{broken"],
    ["is not an object with text", JSON.stringify({ title: 5, description: null })],
  ])("starts empty when the saved draft %s", (_label, raw) => {
    window.localStorage.setItem(DRAFT_KEY, raw);
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    expect(title()).toHaveValue("");
    expect(description()).toHaveValue("");
  });

  it("still closes when the draft cannot be kept on this device", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);

    await user.type(title(), "Keep me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save draft" }),
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before closing with Escape when there is something to lose", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);
    await user.type(title(), "Half written");

    await user.keyboard("{Escape}");

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("ReportIssueDialog sending", () => {
  it("sends with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);
    await user.type(title(), "Cannot save");

    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.post).toHaveBeenCalledWith("/api/v1/issues", expect.objectContaining({ title: "Cannot save" }));
  });

  it("reports an issue that could not be sent, and keeps the form", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    await user.type(title(), "Cannot save");

    await user.click(screen.getByRole("button", { name: /^Create/u }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(title()).toHaveValue("Cannot save");
  });

  it("says when the report was sent but a screenshot could not be attached", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ id: "new-issue" }).mockRejectedValueOnce(new Error("big"));
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);
    await user.type(title(), "Cannot save");
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, PNG());

    await user.click(screen.getByRole("button", { name: /^Create/u }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Your report was sent, but some images could not be attached.",
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open with an empty form for the next one when Create more is ticked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Create more" }));
    await user.type(title(), "First");

    await user.click(screen.getByRole("button", { name: /^Create/u }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title()).toHaveValue("");
    expect(title()).toHaveFocus();
  });

  it("ignores a second send while the first is still going", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockReturnValue(new Promise(() => {}));
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    await user.type(title(), "Cannot save");

    await user.keyboard("{Control>}{Enter}{Enter}{/Control}");

    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe("ReportIssueDialog description", () => {
  it("switches between writing and a rendered preview", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("Nothing to preview")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Write" }));
    await user.type(description(), "**hello**");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("hello").tagName).toBe("STRONG");
  });

  it("formats the selected words from the toolbar and from the keyboard", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    await user.type(description(), "word");
    (description() as HTMLTextAreaElement).setSelectionRange(0, 4);

    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(description()).toHaveValue("**word**");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    description().focus();
    (description() as HTMLTextAreaElement).setSelectionRange(2, 6);
    await user.keyboard("{Control>}i{/Control}");
    expect(description()).toHaveValue("**_word_**");
    await user.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
    await user.keyboard("{Control>}x{/Control}");
    expect(description()).toHaveValue("**_word_**");
  });
});

describe("ReportIssueDialog screenshots", () => {
  it("takes images pasted into the form, and ignores a paste without any", async () => {
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    const form = description().closest("form")!;

    fireEvent.paste(form, { clipboardData: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();

    fireEvent.paste(form, { clipboardData: { files: [PNG()] } });
    expect(await screen.findByRole("button", { name: "Remove image" })).toBeInTheDocument();
  });

  it("takes images dropped on the description, and lets one be removed again", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    const box = description().parentElement!;

    fireEvent.dragOver(box, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.dragOver(box, { dataTransfer: { types: ["text/plain"], files: [] } });
    fireEvent.drop(box, { dataTransfer: { files: [] } });
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();

    fireEvent.drop(box, { dataTransfer: { files: [PNG()] } });
    await user.click(await screen.findByRole("button", { name: "Remove image" }));

    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
  });

  it("opens the file picker from the attach hint", async () => {
    const user = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await user.click(screen.getByRole("button", { name: /Paste, drop, or click/ }));

    expect(click).toHaveBeenCalled();
  });
});
