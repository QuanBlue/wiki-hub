import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RichTextContent,
  normalizeConfluenceCodeMacros,
} from "@/components/pages/rich-text-editor";

describe("Confluence macros", () => {
  it("finds a view-file name from a plain filename attribute or a bare parameter", () => {
    expect(
      normalizeConfluenceCodeMacros(
        '<ac:structured-macro ac:name="view-file"><x filename="plain.pdf"/></ac:structured-macro>',
      ),
    ).toContain('data-attachment="plain.pdf"');
    expect(
      normalizeConfluenceCodeMacros(
        '<ac:structured-macro ac:name="viewdoc"><ac:parameter ac:name="name">bare.docx</ac:parameter></ac:structured-macro>',
      ),
    ).toContain('data-attachment="bare.docx"');
  });

  it("drops a view-file macro that names no file, and leaves unknown macros alone", () => {
    expect(
      normalizeConfluenceCodeMacros(
        '<ac:structured-macro ac:name="view-file"></ac:structured-macro>',
      ),
    ).toBe("");
    const toc =
      '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="x">1</ac:parameter></ac:structured-macro>';
    expect(normalizeConfluenceCodeMacros(toc)).toBe(toc);
  });

  it("reads a legacy card's extension badge when it has a different style", () => {
    const legacy =
      '<div class="confluence-macro-view-file"><a href="/content">Download</a><p>Report</p><div class="uppercase tracking">PDF</div></div></div>';

    expect(normalizeConfluenceCodeMacros(legacy)).toContain(
      'data-attachment="Report.pdf"',
    );
  });

  it("leaves a legacy card alone when no file name can be found", () => {
    const legacy =
      '<div class="confluence-macro-view-file"><a href="/content">Download</a></div></div>';

    expect(normalizeConfluenceCodeMacros(legacy)).toBe(legacy);
  });
});

describe("diff highlights and anchors", () => {
  it("keeps added and deleted text marked", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<p><mark class="wh-diff-add">new</mark> <mark class="wh-diff-delete">old</mark></p>'
        }
      />,
    );

    await screen.findByText("new");
    expect(container.querySelector("mark.wh-diff-add")).not.toBeNull();
    expect(container.querySelector("mark.wh-diff-delete")).not.toBeNull();
  });

  it("opens ordinary links in a new tab but keeps same-page anchors in place", async () => {
    render(
      <RichTextContent
        content={
          '<p><a href="https://example.test">out</a> <a href="#part">jump</a></p>'
        }
      />,
    );

    expect(await screen.findByRole("link", { name: "out" })).toHaveAttribute(
      "target",
      "_blank",
    );
    const anchor = screen.getByRole("link", { name: "jump" });
    expect(anchor).not.toHaveAttribute("target");
    expect(anchor).not.toHaveAttribute("rel");
  });
});

describe("block indent from saved pages", () => {
  it("reads an indent back from the margin it was saved with", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<p style="margin-left: 4rem">in</p><p style="margin-left: 4px">odd</p>'
        }
      />,
    );

    await screen.findByText("in");
    expect((container.querySelector("p") as HTMLElement).style.marginLeft).toBe(
      "4rem",
    );
    expect(
      (container.querySelectorAll("p")[1] as HTMLElement).style.marginLeft,
    ).toBe("");
  });
});
