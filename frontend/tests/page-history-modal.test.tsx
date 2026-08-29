import { describe, expect, it } from "vitest";

import { highlightedRevisionHtml } from "@/components/pages/page-history-modal";
import type { PageRevisionDiff } from "@/types/api";

const attachment = (id: string, filename: string) =>
  `<a href="/api/v1/attachments/${id}/content">${filename}</a>`;

const emptyDiff: PageRevisionDiff = {
  from_version: 1,
  to_version: 2,
  title_changed: false,
  from_title: "Page",
  to_title: "Page",
  chunks: [],
  added_count: 0,
  deleted_count: 0,
  lines: [],
};

describe("highlightedRevisionHtml attachment diff", () => {
  it("marks only attachments added in the newer revision", () => {
    const previous = `<p>${attachment("11111111-1111-1111-1111-111111111111", "existing.pdf")}</p>`;
    const current = `<p>${attachment("11111111-1111-1111-1111-111111111111", "existing.pdf")}${attachment("22222222-2222-2222-2222-222222222222", "added.pdf")}</p>`;

    const html = highlightedRevisionHtml(current, emptyDiff, "new", previous);

    expect(html).toContain('href="/api/v1/attachments/11111111-1111-1111-1111-111111111111/content"');
    expect(html).not.toMatch(/existing\.pdf[^>]*data-diff-kind="add"/);
    expect(html).toMatch(/added\.pdf[^>]*data-diff-kind="add"|data-diff-kind="add"[^>]*>added\.pdf/);
  });

  it("marks only attachments removed from the newer revision", () => {
    const removed = attachment("33333333-3333-3333-3333-333333333333", "removed.pdf");
    const previous = `<p>${attachment("11111111-1111-1111-1111-111111111111", "existing.pdf")}${removed}</p>`;
    const current = `<p>${attachment("11111111-1111-1111-1111-111111111111", "existing.pdf")}</p>`;

    const html = highlightedRevisionHtml(previous, emptyDiff, "old", current);

    expect(html).not.toMatch(/existing\.pdf[^>]*data-diff-kind="delete"/);
    expect(html).toMatch(/removed\.pdf[^>]*data-diff-kind="delete"|data-diff-kind="delete"[^>]*>removed\.pdf/);
  });

  it("marks the cells of an added table row", () => {
    const diff: PageRevisionDiff = {
      ...emptyDiff,
      lines: [
        {
          operation: "add",
          old_line_number: null,
          new_line_number: 1,
          old_text: null,
          new_text: "new heading new value",
          new_segments: [{ operation: "add", text: "new heading new value" }],
          old_segments: [],
        },
      ],
    };

    const html = highlightedRevisionHtml(
      "<table><tbody><tr><td>new heading</td><td>new value</td></tr></tbody></table>",
      diff,
      "new",
      "",
    );

    expect(html).toContain('class="wh-diff-line-add"');
  });
});
