import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { citeLinks } from "@/lib/ai-answer";

describe("citation marks in an AI answer", () => {
  it("turns each [n] into a mark, and leaves other brackets alone", () => {
    expect(citeLinks("A [1] b [2][3], arr[x] and [10].")).toBe(
      "A [1](cite:1) b [2](cite:2)[3](cite:3), arr[x] and [10](cite:10).",
    );
    expect(citeLinks("[123] stays")).toBe("[123] stays");
  });

  it("renders a numbered button that reports its number", async () => {
    const onCite = vi.fn();
    render(
      <IssueMarkdown
        source={citeLinks("Pay on the 25th [2].")}
        onCite={onCite}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "2" }));

    expect(onCite).toHaveBeenCalledWith(2);
    expect(screen.getByText(/Pay on the 25th/)).toBeInTheDocument();
  });

  it("shows plain [n] text when nothing handles marks", () => {
    const { container } = render(
      <IssueMarkdown source={citeLinks("Pay on the 25th [2].")} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toHaveTextContent("Pay on the 25th [2].");
  });

  it("does not turn an arbitrary link target into a mark", () => {
    const { container } = render(
      <IssueMarkdown
        source="[1](cite:abc) and [2](javascript:alert(1))"
        onCite={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("marks _italic_ only at word edges, so names with underscores are left alone", () => {
    const { container } = render(
      <IssueMarkdown source="_emphasis_ and nutifood_vts/x and a_b_c and snake_case_name" />,
    );

    expect(container.querySelectorAll("em")).toHaveLength(1);
    expect(container.querySelector("em")).toHaveTextContent("emphasis");
    expect(container).toHaveTextContent(
      "nutifood_vts/x and a_b_c and snake_case_name",
    );
  });
});
