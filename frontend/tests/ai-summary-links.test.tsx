import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import {
  linkAttachments,
  openAttachment,
  type SummaryAttachment,
} from "@/lib/ai-summary";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const files: SummaryAttachment[] = [
  {
    id: ID_A,
    filename: "VTS_DevSecOps_CICD_v1.pptx",
    content_type: "application/vnd.ms-powerpoint",
  },
  { id: ID_B, filename: "guide.pdf", content_type: "application/pdf" },
];

describe("linkAttachments", () => {
  it("turns a file name in the summary into an attachment link", () => {
    expect(
      linkAttachments("See VTS_DevSecOps_CICD_v1.pptx for slides.", files),
    ).toBe(`See [VTS_DevSecOps_CICD_v1.pptx](attachment:${ID_A}) for slides.`);
  });

  it("links a name the model made bold or put in code, dropping the wrapper", () => {
    expect(linkAttachments("**guide.pdf** and `guide.pdf`", files)).toBe(
      `[guide.pdf](attachment:${ID_B}) and [guide.pdf](attachment:${ID_B})`,
    );
  });

  it("links every mention, and leaves other names and paths alone", () => {
    const out = linkAttachments(
      "guide.pdf, then data_guide.pdf and /files/guide.pdf, guide.pdf.",
      files,
    );

    expect(out).toBe(
      `[guide.pdf](attachment:${ID_B}), then data_guide.pdf and /files/guide.pdf, [guide.pdf](attachment:${ID_B}).`,
    );
  });

  it("prefers the longer name when one contains another", () => {
    const nested: SummaryAttachment[] = [
      { id: ID_A, filename: "plan.pdf", content_type: "application/pdf" },
      {
        id: ID_B,
        filename: "plan.pdf.bak",
        content_type: "application/octet-stream",
      },
    ];

    expect(linkAttachments("plan.pdf.bak", nested)).toBe(
      `[plan.pdf.bak](attachment:${ID_B})`,
    );
  });

  it("matches names with regex characters literally and skips ones with brackets", () => {
    const odd: SummaryAttachment[] = [
      { id: ID_A, filename: "a+b (v2).docx", content_type: "x" },
      { id: ID_B, filename: "[draft].docx", content_type: "x" },
    ];

    expect(linkAttachments("a+b (v2).docx and [draft].docx", odd)).toBe(
      `[a+b (v2).docx](attachment:${ID_A}) and [draft].docx`,
    );
  });

  it("returns the summary untouched when there are no attachments", () => {
    expect(linkAttachments("Nothing to link.", [])).toBe("Nothing to link.");
  });
});

describe("openAttachment", () => {
  it("asks the page to open that attachment's viewer", () => {
    const heard = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", heard);

    openAttachment(ID_A);

    window.removeEventListener("wikihub:open-attachment-modal", heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      attachmentId: ID_A,
    });
  });
});

describe("IssueMarkdown links", () => {
  it("makes a bare web address a link when autolink is on, without swallowing the full stop", () => {
    render(
      <IssueMarkdown
        autolink
        source="Guide at http://tailieu.gpdn.net/pages/viewpage.action?pageId=20092480."
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "http://tailieu.gpdn.net/pages/viewpage.action?pageId=20092480",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows an address with a placeholder as copyable code, not a link, and drops the model's backslashes", () => {
    const { container } = render(
      <IssueMarkdown
        autolink
        source={
          "Open http://\<ip-server\>:9090 then Status \> Targets, or http://localhost:9090."
        }
      />,
    );

    const code = container.querySelector("code");
    expect(code).toHaveTextContent("http://<ip-server>:9090");
    expect(screen.queryByRole("link", { name: /ip-server/ })).toBeNull();
    // A real address next to it is still a link.
    expect(
      screen.getByRole("link", { name: "http://localhost:9090" }),
    ).toHaveAttribute("href", "http://localhost:9090");
    expect(container).toHaveTextContent("Status > Targets");
  });

  it("leaves a bare address as plain text unless autolink is on", () => {
    render(<IssueMarkdown source="See https://example.com/x for more." />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/https:\/\/example.com\/x/)).toBeInTheDocument();
  });

  it("does not link an address inside code, and still links a labelled one", () => {
    render(
      <IssueMarkdown
        autolink
        source="Run `curl https://example.com/api` or open [the docs](https://example.com/docs)."
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "the docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
  });

  it("only allows web addresses: a javascript: address stays plain text", () => {
    render(
      <IssueMarkdown
        autolink
        source="javascript:alert(1) and [x](javascript:alert(1))"
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("turns an attachment link into a button that reports the id", async () => {
    const onOpen = vi.fn();
    render(
      <IssueMarkdown
        source={`Open [guide.pdf](attachment:${ID_B}) now`}
        onOpenAttachment={onOpen}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "guide.pdf" }));

    expect(onOpen).toHaveBeenCalledWith(ID_B);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows just the name when nothing can open attachments", () => {
    render(
      <IssueMarkdown source={`Open [guide.pdf](attachment:${ID_B}) now`} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Open guide\.pdf now/)).toBeInTheDocument();
  });
});

describe("aiStatus", () => {
  it("counts a failed lookup as off, and asks again next time", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    const { aiStatus } = await import("@/lib/ai-summary");
    const spy = vi.spyOn(api, "get").mockRejectedValueOnce(new Error("down"));

    expect(await aiStatus()).toEqual({ enabled: false, can_configure: false });

    spy.mockResolvedValueOnce({ enabled: true, can_configure: true });
    expect(await aiStatus()).toEqual({ enabled: true, can_configure: true });
    spy.mockRestore();
  });
});
