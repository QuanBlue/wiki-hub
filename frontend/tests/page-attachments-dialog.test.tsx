import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageAttachmentsDialog } from "@/components/pages/page-attachments-dialog";
import { CHAT_OPEN_EVENT } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const content = `<a href="/api/v1/attachments/${A}/content">a</a><img src="/api/v1/attachments/${B}/content"><a href="/api/v1/attachments/${A}/content">again</a>`;

function renderDialog(props: Partial<React.ComponentProps<typeof PageAttachmentsDialog>> = {}) {
  return render(
    <PageAttachmentsDialog
      pageTitle="Runbook"
      content={content}
      open
      onOpenChange={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  mocked.get.mockImplementation(async (url: string) => {
    if (url.includes("/ai/status")) return { enabled: false, can_configure: false };
    if (url.endsWith(A)) return { id: A, filename: "a.pdf", content_type: "application/pdf", size_bytes: 500 };
    return { id: B, filename: "b.zip", content_type: "application/zip", size_bytes: 5 * 1024 * 1024 };
  });
});

describe("PageAttachmentsDialog", () => {
  it("lists each embedded file once, with readable sizes", async () => {
    renderDialog();
    expect(screen.getByText("Loading attachments...")).toBeInTheDocument();
    expect(await screen.findByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("application/pdf · 500 B")).toBeInTheDocument();
    expect(screen.getByText("application/zip · 5.0 MB")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith(`/api/v1/attachments/${A}`);
    expect(mocked.get).toHaveBeenCalledWith(`/api/v1/attachments/${B}`);
    expect(screen.getByRole("link", { name: "Download a.pdf" })).toHaveAttribute(
      "href",
      `/api/v1/attachments/${A}/content`,
    );
  });

  it("says whether search can read each file, and offers to ask about readable ones", async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url.includes("/ai/status")) return { enabled: true, can_configure: false };
      if (url.endsWith(A))
        return { id: A, filename: "a.pdf", content_type: "application/pdf", size_bytes: 500, text_status: "ok" };
      return { id: B, filename: "scan.pdf", content_type: "application/pdf", size_bytes: 5, text_status: "scanned" };
    });
    const onOpenChange = vi.fn();
    const opened: unknown[] = [];
    window.addEventListener(CHAT_OPEN_EVENT, (event) => opened.push((event as CustomEvent).detail));
    renderDialog({ onOpenChange });

    expect(await screen.findByText("Content read")).toBeInTheDocument();
    expect(screen.getByText("Scanned PDF")).toHaveAttribute(
      "title",
      expect.stringContaining("no selectable text"),
    );
    // Only the file whose words were read can be asked about.
    const ask = await screen.findAllByRole("button", { name: /Ask the assistant about/ });
    expect(ask).toHaveLength(1);
    await userEvent.click(ask[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(opened).toEqual([{ file: { id: A, filename: "a.pdf" } }]);
  });

  it("offers no question while the assistant is off", async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url.includes("/ai/status")) return { enabled: false, can_configure: false };
      return { id: A, filename: "a.pdf", content_type: "application/pdf", size_bytes: 500, text_status: "ok" };
    });
    renderDialog({ content: `/api/v1/attachments/${A}` });
    expect(await screen.findByText("Content read")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask the assistant/ })).not.toBeInTheDocument();
  });

  it("formats kilobyte sizes", async () => {
    mocked.get.mockImplementation(async (url: string) =>
      url.includes("/ai/status")
        ? { enabled: false, can_configure: false }
        : { id: A, filename: "k.txt", content_type: "text/plain", size_bytes: 2048 },
    );
    renderDialog({ content: `/api/v1/attachments/${A}` });
    expect(await screen.findByText("text/plain · 2 KB")).toBeInTheDocument();
  });

  it("opens an attachment through the shared modal event", async () => {
    const seen: string[] = [];
    window.addEventListener("wikihub:open-attachment-modal", (event) =>
      seen.push((event as CustomEvent).detail.attachmentId),
    );
    renderDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Open a.pdf" }));
    expect(seen).toEqual([A]);
  });

  it("says so when nothing is embedded", async () => {
    renderDialog({ content: "<p>none</p>" });
    expect(await screen.findByText("No attachments are embedded in this page.")).toBeInTheDocument();
  });

  it("shows the empty state when the metadata cannot be loaded", async () => {
    mocked.get.mockRejectedValue(new Error("x"));
    renderDialog();
    expect(await screen.findByText("No attachments are embedded in this page.")).toBeInTheDocument();
  });

  it("does nothing while closed, and ignores a late response after closing", async () => {
    const closed = renderDialog({ open: false });
    expect(mocked.get).not.toHaveBeenCalled();
    closed.unmount();

    let resolve: (value: unknown) => void = () => {};
    mocked.get.mockReturnValue(new Promise((r) => (resolve = r)));
    const view = renderDialog();
    view.unmount();
    resolve({ id: A, filename: "late.pdf", content_type: "x", size_bytes: 1 });
    await waitFor(() => expect(screen.queryByText("late.pdf")).not.toBeInTheDocument());
  });
});
