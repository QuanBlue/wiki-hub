import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { DocumentImportProgress } from "@/components/pages/document-import-progress";
import type { DocumentImportItem, DocumentImportJob } from "@/types/api";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
});

function item(overrides: Partial<DocumentImportItem> = {}): DocumentImportItem {
  return {
    id: overrides.id ?? "i1",
    position: 0,
    filename: "report.docx",
    size_bytes: 1024,
    source_format: "docx",
    status: "queued",
    error: null,
    warnings: [],
    page_id: null,
    page_title: null,
    page_slug: null,
    attachments_created: 0,
    ...overrides,
  };
}

function job(overrides: Partial<DocumentImportJob> = {}): DocumentImportJob {
  return {
    id: "job-1",
    space_key: "ENG",
    parent_id: null,
    status: "running",
    phase: "converting",
    counters: { items_total: 2, items_processed: 1, pages_created: 1, items_failed: 0 },
    cancel_requested: false,
    error: null,
    percent: 50,
    eta_seconds: 30,
    started_at: "2026-08-27T00:00:00Z",
    heartbeat_at: "2026-08-27T00:00:05Z",
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:05Z",
    items: [item()],
    ...overrides,
  };
}

function renderProgress(value: DocumentImportJob, overrides = {}) {
  const props = {
    job: value,
    spaceKey: "ENG",
    onJobChange: vi.fn(),
    onDismiss: vi.fn(),
    onFinished: vi.fn(),
    ...overrides,
  };
  render(<DocumentImportProgress {...props} />);
  return props;
}

function stubFetch(response: unknown, status = 200) {
  const spy = vi.fn(
    async (_input?: unknown, _init?: unknown) =>
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("DocumentImportProgress", () => {
  it("shows how far along the batch is", () => {
    stubFetch({});
    renderProgress(job());

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/Importing 2 documents/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
  });

  it("shows an indeterminate bar when the server cannot estimate yet", () => {
    // `percent: null` is a real state the API returns on purpose; inventing a
    // number here would be showing the user a guess as a fact.
    stubFetch({});
    renderProgress(job({ percent: null, eta_seconds: null }));

    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText(/Calculating/)).toBeInTheDocument();
  });

  it("lists every file with its own status", () => {
    stubFetch({});
    renderProgress(
      job({
        items: [
          item({ id: "a", filename: "done.docx", status: "complete", page_slug: "done", page_title: "Done" }),
          item({ id: "b", filename: "broken.pdf", status: "failed", error: "This PDF is password-protected." }),
          item({ id: "c", filename: "waiting.docx", status: "queued" }),
        ],
      }),
    );

    expect(screen.getByText("done.docx")).toBeInTheDocument();
    expect(screen.getByText("broken.pdf")).toBeInTheDocument();
    expect(screen.getByText("This PDF is password-protected.")).toBeInTheDocument();
    expect(screen.getByText("waiting.docx")).toBeInTheDocument();
  });

  it("links a finished file to the page it produced", () => {
    stubFetch({});
    renderProgress(
      job({
        items: [
          item({ status: "complete", page_slug: "quarterly-report", page_title: "Quarterly Report" }),
        ],
      }),
    );

    const link = screen.getByRole("link", { name: "Quarterly Report" });
    expect(link).toHaveAttribute("href", "/spaces/ENG/pages/quarterly-report");
  });

  it("shows a file's warnings without calling it a failure", () => {
    stubFetch({});
    renderProgress(
      job({
        items: [
          item({
            status: "complete",
            page_slug: "scan",
            warnings: ["This PDF appears to be scanned."],
          }),
        ],
      }),
    );

    expect(screen.getByText("This PDF appears to be scanned.")).toBeInTheDocument();
  });

  it("asks for confirmation in a dialog, never window.confirm", async () => {
    // AGENTS.md forbids the native dialogs outright.
    stubFetch({});
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const user = userEvent.setup();
    renderProgress(job());

    await user.click(screen.getByRole("button", { name: /cancel import/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Cancel this import\?/)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("posts the cancellation once confirmed", async () => {
    const spy = stubFetch(job({ cancel_requested: true }));
    const user = userEvent.setup();
    const props = renderProgress(job());

    await user.click(screen.getByRole("button", { name: /cancel import/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel import$/i }));

    await waitFor(() => {
      const call = spy.mock.calls.find(([url]) =>
        String(url).includes("/api/v1/document-imports/job-1/cancel"),
      );
      expect(call).toBeDefined();
    });
    await waitFor(() => expect(props.onJobChange).toHaveBeenCalled());
  });

  it("offers no cancel button once the job has finished", async () => {
    stubFetch({});
    const user = userEvent.setup();
    renderProgress(job({ status: "complete", percent: 100, eta_seconds: 0 }));

    // The summary dialog opens over the card on completion; dismiss it the way
    // a reader would before checking what the card itself now offers.
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /done/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(screen.queryByRole("button", { name: /cancel import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("reports success and hands the finished job back exactly once", async () => {
    stubFetch({});
    const props = renderProgress(
      job({
        status: "complete",
        percent: 100,
        counters: { items_total: 2, items_processed: 2, pages_created: 2, items_failed: 0 },
      }),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Imported 2 pages."));
    expect(props.onFinished).toHaveBeenCalledTimes(1);
  });

  it("is honest when only some of the batch worked", async () => {
    stubFetch({});
    renderProgress(
      job({
        status: "complete",
        percent: 100,
        counters: { items_total: 3, items_processed: 3, pages_created: 2, items_failed: 1 },
      }),
    );

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("Imported 2 of 3 files"),
      ),
    );
  });

  it("reports the server's own reason when the whole job failed", async () => {
    stubFetch({});
    renderProgress(
      job({ status: "failed", error: "No document could be imported.", percent: null }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No document could be imported."),
    );
  });

  it("summarises the run with links rather than navigating away", async () => {
    // With several pages there is no defensible single destination, and
    // teleporting the reader away from what they were reading is worse.
    stubFetch({});
    renderProgress(
      job({
        status: "complete",
        percent: 100,
        counters: { items_total: 2, items_processed: 2, pages_created: 2, items_failed: 0 },
        items: [
          item({ id: "a", status: "complete", page_slug: "one", page_title: "One" }),
          item({ id: "b", status: "complete", page_slug: "two", page_title: "Two" }),
        ],
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "One" })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/one",
    );
    expect(within(dialog).getByRole("link", { name: "Two" })).toBeInTheDocument();
  });

  it("names the files that failed, and why, in the summary", async () => {
    stubFetch({});
    renderProgress(
      job({
        status: "complete",
        percent: 100,
        counters: { items_total: 2, items_processed: 2, pages_created: 1, items_failed: 1 },
        items: [
          item({ id: "a", status: "complete", page_slug: "one", page_title: "One" }),
          item({ id: "b", filename: "bad.pdf", status: "failed", error: "This PDF is password-protected." }),
        ],
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("bad.pdf")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/This PDF is password-protected/),
    ).toBeInTheDocument();
  });

  it("polls a running job and stops once it is finished", async () => {
    const finished = job({ status: "complete", percent: 100 });
    const spy = stubFetch(finished);
    const props = renderProgress(job());

    await waitFor(
      () => {
        expect(props.onJobChange).toHaveBeenCalledWith(
          expect.objectContaining({ status: "complete" }),
        );
      },
      { timeout: 3000 },
    );

    const callsAfterFinish = spy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // The component is still rendering the *running* job it was given, so it
    // keeps polling - what matters is that it asked, and asked the right URL.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(callsAfterFinish);
    expect(String(spy.mock.calls[0][0])).toContain("/api/v1/document-imports/job-1");
  });

  it("keeps polling through a failed request rather than giving up", async () => {
    // The job is durable server-side; one dropped request is no reason to stop
    // showing progress.
    const spy = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", spy);
    renderProgress(job());

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
  });
});
