import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssueMarkdown } from "@/components/issues/issue-markdown";

describe("an assistant's answer drawn richly", () => {
  it("keeps bold to a weight, and highlights the one thing to remember", () => {
    const { container } = render(
      <IssueMarkdown
        rich
        source={"**Yes, it can.** Open ==Administration > Backup== now."}
      />,
    );

    expect(screen.getByText("Yes, it can.")).toHaveClass("font-semibold");
    expect(screen.getByText("Yes, it can.")).not.toHaveClass("text-primary");
    const mark = container.querySelector("mark");
    expect(mark).toHaveTextContent("Administration > Backup");
    expect(mark).toHaveClass("bg-warning-bg");
  });

  it("keeps bold and code inside a highlight", () => {
    const { container } = render(
      <IssueMarkdown rich source={"==run `make` for **all**=="} />,
    );

    const mark = container.querySelector("mark");
    expect(mark?.querySelector("code")).toHaveTextContent("make");
    expect(mark?.querySelector("strong")).toHaveTextContent("all");
  });

  it("draws > [!KIND] as a coloured note with its text, one for every kind", () => {
    const kinds = ["NOTE", "TIP", "IMPORTANT", "WARNING", "SUCCESS", "DANGER"];
    const source = kinds
      .map((kind) => `> [!${kind}] ${kind.toLowerCase()} text\n> and more`)
      .join("\n\n");
    render(<IssueMarkdown rich source={source} />);

    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(kinds.length);
    expect(notes[0]).toHaveAttribute("aria-label", "Note");
    expect(notes[3]).toHaveTextContent("warning text");
    expect(notes[3]).toHaveTextContent("and more");
    expect(notes[3].className).toContain("bg-warning-bg");
    expect(notes[4]).toHaveAttribute("aria-label", "Done");
  });

  it("gives lists, headings, quotes and tables their own form without more colour", () => {
    const { container } = render(
      <IssueMarkdown
        rich
        source={
          "### Steps\n\n1. one\n2. two\n\n- a\n- b\n\n| Name | Role |\n|---|---|\n| Ann | admin |"
        }
      />,
    );

    const heading = screen.getByRole("heading", { name: "Steps" });
    expect(heading).toHaveClass("border-b");
    expect(heading).not.toHaveClass("text-primary");
    expect(container.querySelector("ol")?.className).toContain(
      "marker:text-primary",
    );
    expect(container.querySelector("ul")?.className).toContain(
      "marker:text-primary",
    );
    expect(screen.getByText("Ann")).toHaveClass("font-medium");
  });

  it("is plain everywhere else: no colour, no callout, == is just text", () => {
    const { container } = render(
      <IssueMarkdown source={"**bold** ==x==\n\n> [!TIP] kept as a quote"} />,
    );

    expect(screen.getByText("bold")).not.toHaveClass("text-primary");
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.textContent).toContain("==x==");
  });

  it("sets a single-asterisk word in italics, and leaves a pattern alone", () => {
    const { container } = render(
      <IssueMarkdown
        rich
        source={"A *term* and **bold** but *.log and *.txt stay."}
      />,
    );

    const italics = [...container.querySelectorAll("em")].map(
      (em) => em.textContent,
    );
    expect(italics).toContain("term");
    expect(screen.getByText("bold")).toHaveClass("font-semibold");
    // A glob is not emphasis: it stays as typed.
    expect(container.textContent).toContain("*.log and *.txt stay.");
  });

  it("draws a quote as a soft panel and gives table rows a hover", () => {
    const { container } = render(
      <IssueMarkdown
        rich
        source={"> from the guide\n\n| a | b |\n|---|---|\n| 1 | 2 |"}
      />,
    );

    expect(container.querySelector("blockquote")?.className).toContain(
      "bg-surface-sunken",
    );
    expect(container.querySelector("tbody tr")?.className).toContain(
      "hover:bg-surface-hover",
    );
  });

  it("does not turn single asterisks into italics outside the assistant", () => {
    const { container } = render(<IssueMarkdown source={"a *b* c"} />);

    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toContain("*b*");
  });
});
