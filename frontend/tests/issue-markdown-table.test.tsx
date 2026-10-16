import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { citeLinks } from "@/lib/ai-answer";

const TABLE = [
  "| System | Address | Purpose |",
  "| --- | --- | --- |",
  "| **Prometheus** | http://117.1.29.44:9091/graph | Metrics [1] |",
  "| Grafana | http://117.1.29.44:8801/login | Dashboards [2] |",
].join("\n");

describe("tables in Markdown", () => {
  it("renders a pipe table with a header row and one row per item", () => {
    render(<IssueMarkdown source={TABLE} autolink />);

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((cell) => cell.textContent)).toEqual([
      "System",
      "Address",
      "Purpose",
    ]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // the header and two items
    expect(within(rows[1]!).getByText("Prometheus").tagName).toBe("STRONG");
    expect(within(rows[2]!).getByText("Dashboards [2]")).toBeInTheDocument();
  });

  it("keeps web addresses clickable and citations pressable inside cells", async () => {
    const onCite = vi.fn();
    render(
      <IssueMarkdown source={citeLinks(TABLE)} autolink onCite={onCite} />,
    );

    const link = screen.getByRole("link", {
      name: "http://117.1.29.44:9091/graph",
    });
    expect(link).toHaveAttribute("href", "http://117.1.29.44:9091/graph");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onCite).toHaveBeenCalledWith(2, false);
  });

  it("pads a short row and ignores cells past the header", () => {
    render(
      <IssueMarkdown
        source={"| A | B |\n|---|---|\n| only |\n| 1 | 2 | extra |"}
      />,
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]!).getAllByRole("cell")).toHaveLength(2);
    expect(
      within(rows[2]!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1", "2"]);
  });

  it("starts a table right after a paragraph and goes on with text after it", () => {
    render(
      <IssueMarkdown
        source={"Here they are:\n| A | B |\n|---|---|\n| 1 | 2 |\n\nDone."}
      />,
    );

    expect(screen.getByText("Here they are:")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });

  it("shows markup typed in a cell as text, never as elements", () => {
    const { container } = render(
      <IssueMarkdown
        source={"| A |\n|---|\n| <img src=x onerror=alert(1)> |"}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("does not stall on a line that only starts with a pipe", () => {
    render(
      <IssueMarkdown
        source={"| not a table\nstill text\n\n| a | b |\nno separator"}
      />,
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/not a table/)).toBeInTheDocument();
    expect(screen.getByText(/no separator/)).toBeInTheDocument();
  });
});
