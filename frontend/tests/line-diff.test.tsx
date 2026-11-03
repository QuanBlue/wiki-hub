import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiffViewToggle, LineDiff, revisionHtml, type LineDiffData } from "@/components/pages/line-diff";
import { LocaleProvider } from "@/lib/i18n/context";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const block = (text: string) => ({ text, md: text });

function renderDiff(diff: LineDiffData) {
  return render(
    <LocaleProvider initialLocale="en">
      <LineDiff diff={diff} headings={["Before", "After"]} counts={["1 removal", "1 addition"]} />
    </LocaleProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("line diff", () => {
  it("escapes Markdown revisions for the line renderer", () => {
    expect(revisionHtml({ content: "a&b\n<c>", content_format: "markdown" })).toBe("<p>a&amp;b</p><p>&lt;c&gt;</p>");
    expect(revisionHtml({ content: "<p>raw</p>", content_format: "html" })).toBe("<p>raw</p>");
  });

  it("renders paired and one-sided lines with word changes", () => {
    renderDiff({
      rows: [
        { kind: "same", a: block("Shared"), b: block("Shared") },
        { kind: "change", a: block("Old word"), b: block("New word") },
        { kind: "change", a: block("Removed"), b: null },
        { kind: "change", a: null, b: block("Added") },
      ],
      blocks: [[block("Shared"), block("Old word"), block("Removed")], [block("Shared"), block("New word"), block("Added")]],
      same: 1,
      onlyOld: 2,
      onlyNew: 2,
      markup: [],
    });
    expect(screen.getAllByText("Shared")).toHaveLength(2);
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getAllByText("word")).toHaveLength(2);
    expect(document.querySelectorAll('[aria-hidden="true"].bg-surface-sunken')).toHaveLength(2);
  });

  it("shows an empty comparison and explains markup-only changes", () => {
    renderDiff({ rows: [], blocks: [[], []], same: 0, onlyOld: 0, onlyNew: 0, markup: ["links"] });
    expect(screen.getByRole("status")).toHaveTextContent("link addresses");
    expect(screen.getByText(/no lines|empty/i)).toBeInTheDocument();
  });

  it("copies each side and reports clipboard outcomes", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderDiff({ rows: [], blocks: [[block("Left")], [block("Right")]], same: 0, onlyOld: 1, onlyNew: 1, markup: [] });
    const buttons = screen.getAllByRole("button", { name: /copy/i });
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await userEvent.click(buttons[1]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(writeText).toHaveBeenNthCalledWith(1, "Left");
    expect(writeText).toHaveBeenNthCalledWith(2, "Right");
  });

  it("switches between page and line views", async () => {
    const onChange = vi.fn();
    render(<LocaleProvider initialLocale="en"><DiffViewToggle value="pages" onChange={onChange} /></LocaleProvider>);
    const lineButton = screen.getByRole("button", { name: /line by line/i });
    expect(screen.getByRole("button", { name: /page view/i })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(lineButton);
    expect(onChange).toHaveBeenCalledWith("lines");
  });
});
