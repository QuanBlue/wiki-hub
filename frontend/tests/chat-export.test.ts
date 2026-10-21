import { describe, expect, it } from "vitest";

import type { ChatEntry } from "@/lib/ai-chat";
import { chatToMarkdown, exportFileName } from "@/lib/chat-export";

const LABELS = {
  title: "Chat",
  exportedAt: "Exported",
  question: "Question",
  answer: "Answer",
  sources: "Sources",
  alsoRead: "Also read",
  web: "From the internet",
  files: "Files",
  notFound: "No answer was found in the wiki",
  failed: "Failed",
  stopped: "Stopped",
  basis: (basis: string) => `from ${basis}`,
};

const page = {
  n: 2,
  id: "p",
  title: "Thông tin SSH",
  slug: "th-ng-tin-ssh",
  space_key: "3DMS40",
  space_name: "3.dms.saas",
  excerpt: "",
  files: [{ id: "f", filename: "policy.pdf" }],
};

describe("chatToMarkdown", () => {
  it("writes each question with its answer, sources, web pages and pages also read", () => {
    const entries: ChatEntry[] = [
      { id: "1", role: "user", content: "dms4 có bao nhiêu server" },
      {
        id: "2",
        role: "assistant",
        status: "done",
        content: "**33 server** [2].",
        found: true,
        basis: "wiki",
        sources: [page],
        related: [{ ...page, n: 3, title: "Thông tin VM-IP", files: [] }],
        webSources: [
          {
            n: 1,
            title: "Docs",
            url: "https://example.com",
            host: "example.com",
            snippet: "",
          },
        ],
      },
      { id: "3", role: "user", content: "sao chỉ 22 server" },
      {
        id: "4",
        role: "assistant",
        status: "done",
        content: "",
        found: false,
        reason: "not_in_pages",
      },
    ];

    const markdown = chatToMarkdown(entries, LABELS, {
      origin: "http://wiki",
      now: new Date(2026, 9, 21, 15, 30),
    });

    expect(markdown).toContain("## 1. Question\n\ndms4 có bao nhiêu server");
    expect(markdown).toContain("### Answer (from wiki)\n\n**33 server** [2].");
    expect(markdown).toContain(
      "[2] [Thông tin SSH](http://wiki/spaces/3DMS40/pages/th-ng-tin-ssh) (3DMS40) - policy.pdf",
    );
    expect(markdown).toContain("[w1] [Docs](https://example.com)");
    expect(markdown).toContain("**Also read**\n\n- [Thông tin VM-IP]");
    expect(markdown).toContain("## 2. Question\n\nsao chỉ 22 server");
    expect(markdown).toContain(
      "_No answer was found in the wiki (not_in_pages)_",
    );
  });

  it("names the file after the moment it was saved", () => {
    expect(exportFileName(new Date(2026, 9, 21, 9, 5))).toBe(
      "wikihub-chat-2026-10-21-0905.md",
    );
  });
});
