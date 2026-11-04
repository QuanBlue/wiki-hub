import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReportIssueDialog } from "@/components/issues/report-issue-dialog";
import { highlightMarkdown } from "@/lib/issue-markdown-highlight";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const tones = (source: string) =>
  highlightMarkdown(source).map((run) => `${run.tone}:${run.text}`);

describe("highlightMarkdown", () => {
  it("never loses or reorders a character, so the overlay lines up with the caret", () => {
    const samples = [
      "",
      "plain",
      "a **bold** and _italic_ and `code` and [link](https://x.test)\n",
      "# Title\n> quote\n- item\n- [ ] task\n1. one\n\n```\nfenced **not bold**\n```\nend",
      "**unclosed and `also unclosed",
      "trailing newlines\n\n\n",
      "snake_case_name and 2*3*4 and * not a list",
    ];
    for (const sample of samples) {
      expect(
        highlightMarkdown(sample)
          .map((run) => run.text)
          .join(""),
      ).toBe(sample);
    }
  });

  it("marks bold, italic, code and links, dimming the markers", () => {
    expect(tones("a **bold** b")).toEqual(["plain:a ", "marker:**", "bold:bold", "marker:**", "plain: b"]);
    expect(tones("_it_")).toEqual(["marker:_", "italic:it", "marker:_"]);
    expect(tones("`x`")).toEqual(["marker:`", "code:x", "marker:`"]);
    expect(tones("[a](b)")).toEqual(["link:[a](b)"]);
  });

  it("styles headings, quotes and list markers by line", () => {
    expect(tones("### Hi")).toEqual(["marker:### ", "heading:Hi"]);
    expect(tones("> said")).toEqual(["marker:> ", "quote:said"]);
    expect(tones("- [ ] todo")).toEqual(["list:- [ ] ", "plain:todo"]);
    expect(tones("  2. two")).toEqual(["plain:  ", "list:2. ", "plain:two"]);
    // Inline styling still applies inside them.
    expect(tones("## a **b**")).toContainEqual("bold:b");
  });

  it("treats everything between fences as code, with no inline styling", () => {
    expect(tones("```\n**x**\n```")).toEqual(["marker:```\n", "code:**x**\n", "marker:```"]);
  });

  it("leaves unmatched markers and snake_case alone", () => {
    expect(tones("**open")).toEqual(["plain:**open"]);
    expect(tones("snake_case_name")).toEqual(["plain:snake_case_name"]);
  });
});

describe("the issue description box", () => {
  const description = () => screen.getByLabelText("Add a description") as HTMLTextAreaElement;
  const mirror = () => screen.getByTestId("markdown-mirror");

  it("shows the text styled as it is typed, over a transparent textarea", async () => {
    const actor = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    await actor.type(description(), "Chữ **account** hiện");
    expect(description()).toHaveValue("Chữ **account** hiện");
    const bold = Array.from(mirror().querySelectorAll("span")).find((s) => s.textContent === "account");
    expect(bold).toHaveClass("font-bold");
    expect(mirror()).toHaveAttribute("aria-hidden", "true");
    expect(description().className).toContain("text-transparent");
  });

  it("bolds a selected word when Bold is pressed, and it shows at once", async () => {
    const actor = userEvent.setup();
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    await actor.type(description(), "hello account now");
    description().setSelectionRange(6, 13);

    await actor.click(screen.getByRole("button", { name: /bold/i }));

    expect(description()).toHaveValue("hello **account** now");
    const bold = Array.from(mirror().querySelectorAll("span")).find((s) => s.textContent === "account");
    expect(bold).toHaveClass("font-bold");
  });

  it("keeps the styled copy scrolled with the textarea", () => {
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);
    description().scrollTop = 40;
    fireEvent.scroll(description());
    expect(mirror().scrollTop).toBe(40);
  });
});
