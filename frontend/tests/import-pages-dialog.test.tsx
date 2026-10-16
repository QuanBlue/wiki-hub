import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ImportPagesDialog } from "@/components/pages/import-pages-dialog";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
});

/** The dialog uploads through XMLHttpRequest, for `upload.onprogress` - which
 *  `fetch` does not offer - so a stubbed `fetch` never sees these requests. */
class FakeXHR {
  static last: FakeXHR | null = null;
  static status = 201;
  static responseBody = "";
  static failWith: "error" | null = null;
  static hold = false;
  static rawBody: string | null = null;

  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {
    /* no-op */
  }
  send(body: FormData) {
    FakeXHR.last = this;
    this.body = body;
    if (FakeXHR.hold) return;
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 1,
        total: 1,
      } as ProgressEvent);
      if (FakeXHR.failWith === "error") {
        this.onerror?.();
        return;
      }
      this.status = FakeXHR.status;
      this.responseText = FakeXHR.rawBody ?? FakeXHR.responseBody;
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

function stubXHR(
  options: { status?: number; body?: unknown; fail?: "error" } = {},
) {
  FakeXHR.last = null;
  FakeXHR.status = options.status ?? 201;
  FakeXHR.responseBody = JSON.stringify(options.body ?? { id: "job-1", items: [] });
  FakeXHR.failWith = options.fail ?? null;
  FakeXHR.hold = false;
  FakeXHR.rawBody = null;
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
}

function stubMeta(maxUploadBytes = 50 * 1024 * 1024) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ max_upload_size_bytes: maxUploadBytes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function file(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name);
}

async function openDialog(onStarted = vi.fn()) {
  const user = userEvent.setup();
  render(<ImportPagesDialog spaceKey="ENG" onStarted={onStarted} />);
  await user.click(screen.getByRole("button", { name: /import/i }));
  await screen.findByRole("dialog");
  return { user, onStarted };
}

async function choose(files: File[]) {
  const input = document.querySelector<HTMLInputElement>("#import-files");
  expect(input).not.toBeNull();
  // `userEvent.upload` respects the `accept` filter, which would silently drop
  // the very files whose rejection this suite is checking.
  Object.defineProperty(input!, "files", {
    configurable: true,
    value: {
      ...files,
      length: files.length,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        yield* files;
      },
    },
  });
  await act(async () => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ImportPagesDialog", () => {
  it("lists chosen files with their sizes", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    await choose([file("report.docx", 2048)]);

    expect(await screen.findByText("report.docx")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("keeps the submit button disabled until something is chosen", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("rejects an unsupported file inline, beside the file it means", async () => {
    // A toast here would leave the user guessing which of ten files was wrong.
    stubMeta();
    stubXHR();
    await openDialog();
    await choose([file("payload.exe")]);

    expect(await screen.findByText(/cannot import \.exe/i)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("rejects a file larger than the workspace ceiling", async () => {
    stubMeta(1024);
    stubXHR();
    await openDialog();
    await choose([file("huge.docx", 4096)]);

    expect(await screen.findByText(/larger than the/i)).toBeInTheDocument();
  });

  it("still offers the valid files when one of them is rejected", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    await choose([file("good.docx"), file("bad.exe")]);

    await screen.findByText("good.docx");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^import$/i })).toBeEnabled();
  });

  it("lets a chosen file be removed again", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx"), file("b.docx")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: "Remove a.docx" }));

    expect(screen.queryByText("a.docx")).not.toBeInTheDocument();
    expect(screen.getByText("b.docx")).toBeInTheDocument();
  });

  it("does not add the same file twice", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    const same = file("dup.docx");
    await choose([same]);
    await screen.findByText("dup.docx");
    await choose([same]);

    await waitFor(() => {
      expect(screen.getAllByText("dup.docx")).toHaveLength(1);
    });
  });

  it("posts every valid file as multipart form data", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx"), file("b.pdf")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: /import 2 files/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.method).toBe("POST");
    expect(FakeXHR.last!.url).toBe("/api/v1/spaces/ENG/document-imports");
    const sent = FakeXHR.last!.body!;
    expect(sent).toBeInstanceOf(FormData);
    expect(sent.getAll("files")).toHaveLength(2);
    // No page with this name is known to exist - the server is left to decide
    // rather than assuming a conflict for every import.
    expect(sent.get("conflict_mode")).toBe("ask");
  });

  it("sends the parent page id when importing under a page", async () => {
    stubMeta();
    stubXHR();
    const user = userEvent.setup();
    render(
      <ImportPagesDialog
        spaceKey="ENG"
        parentPage={{ id: "page-7", title: "Runbooks" }}
        onStarted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /import/i }));
    await screen.findByRole("dialog");
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("parent_id")).toBe("page-7");
  });

  it("says which parent the pages will land under", async () => {
    stubMeta();
    stubXHR();
    const user = userEvent.setup();
    render(
      <ImportPagesDialog
        spaceKey="ENG"
        parentPage={{ id: "page-7", title: "Runbooks" }}
        onStarted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /import/i }));

    expect(await screen.findByText(/under "Runbooks"/)).toBeInTheDocument();
  });

  it("hands the queued job to its caller and shows progress in the dialog", async () => {
    stubMeta();
    stubXHR({ body: { id: "job-9", status: "queued", items: [] } });
    const onStarted = vi.fn();
    const { user } = await openDialog(onStarted);
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({ id: "job-9" }),
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Importing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel import" })).toBeInTheDocument();
  });

  it("asks before importing over a page with the same filename title", async () => {
    stubMeta();
    stubXHR({ body: { id: "job-10", status: "queued", items: [] } });
    const user = userEvent.setup();
    render(
      <ImportPagesDialog
        spaceKey="ENG"
        existingPages={[{ title: "a", parent_id: null }]}
        onStarted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /import/i }));
    await choose([file("a.docx")]);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    expect(await screen.findByRole("heading", { name: "Page already exists" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace existing" }));
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("conflict_mode")).toBe("replace");
  });

  it("recognizes a copied filename as a duplicate of its original page", async () => {
    stubMeta();
    stubXHR({ body: { id: "job-11", status: "queued", items: [] } });
    const user = userEvent.setup();
    render(
      <ImportPagesDialog
        spaceKey="ENG"
        existingPages={[{ title: "a", parent_id: null }]}
        onStarted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /import/i }));
    await choose([file("a (1).pdf")]);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    expect(await screen.findByRole("heading", { name: "Page already exists" })).toBeInTheDocument();
    expect(screen.getByText(/matching “a \(1\)” already exists/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("conflict_mode")).toBe("rename");
  });

  it("surfaces the server's own reason when the import is refused", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: { detail: { message: "A WikiHub restore is still running." } },
    });
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A WikiHub restore is still running."),
    );
    // The dialog stays open so the files do not have to be chosen again.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the conflict choices when the server detects a missed duplicate", async () => {
    // No `existingPages` is passed, so the client-side check finds nothing -
    // this is the docx/pdf case, where the real title is only known once the
    // server converts the file. The dialog must not assume a conflict just
    // because it cannot rule one out; it only appears once the server says so.
    stubMeta();
    stubXHR({
      status: 409,
      body: {
        error: {
          code: "document_import_conflict",
          message: "One or more pages already exist.",
          details: { conflicts: [{ filename: "a.pdf", title: "a" }] },
        },
      },
    });
    const { user } = await openDialog();
    await choose([file("a.pdf")]);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    expect(await screen.findByRole("heading", { name: "Page already exists" })).toBeInTheDocument();
    expect(screen.getByText(/matching “a” already exists/i)).toBeInTheDocument();
  });

  it("imports straight through when the space has no conflicting page", async () => {
    // The exact regression this guards: submitting into an empty space (or
    // any space with no matching page) must never show "Page already
    // exists" - the server is asked directly and comes back clean.
    stubMeta();
    stubXHR({ body: { id: "job-12", status: "queued", items: [] } });
    const { user } = await openDialog();
    await choose([file("a.pdf")]);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("conflict_mode")).toBe("ask");
    expect(screen.queryByRole("heading", { name: "Page already exists" })).not.toBeInTheDocument();
  });

  it("reports a network failure without losing the chosen files", async () => {
    stubMeta();
    stubXHR({ fail: "error" });
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("a.docx")).toBeInTheDocument();
  });
});

describe("ImportPagesDialog edge cases", () => {
  async function startWith(name = "a.docx") {
    const { user, onStarted } = await openDialog();
    await choose([file(name)]);
    await screen.findByText(name);
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    return { user, onStarted };
  }

  it("keeps only the first twenty documents and says so", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    await choose(Array.from({ length: 21 }, (_, i) => file(`doc-${i}.docx`)));

    expect(await screen.findByText("doc-19.docx")).toBeInTheDocument();
    expect(screen.queryByText("doc-20.docx")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Import at most 20 documents at a time.");
  });

  it("takes files dropped on the drop zone", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    const zone = document.querySelector("#import-files")!.parentElement!;

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("bg-surface-hover");
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file("dropped.docx")] } });
    expect(await screen.findByText("dropped.docx")).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(screen.getAllByText(/\.docx$/)).toHaveLength(1);
  });

  it("forgets the chosen files when the dialog is closed", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /import/i }));
    await screen.findByRole("dialog");

    expect(screen.queryByText("a.docx")).toBeNull();
  });

  it("aborts an upload that is still in flight when the dialog is closed, and warns before leaving", async () => {
    stubMeta();
    stubXHR();
    FakeXHR.hold = true;
    const { user } = await startWith();
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());

    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when the answer cannot be read", async () => {
    stubMeta();
    stubXHR();
    FakeXHR.rawBody = "<html>";
    await startWith();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The server sent a response WikiHub could not read."));
  });

  it.each([
    ["a plain detail", { detail: "Plain detail." }, "Plain detail."],
    ["a top-level message", { message: "Top message." }, "Top message."],
    ["an unusable message", { detail: { message: 42 } }, "The import could not be started."],
  ])("explains a refusal that carries %s", async (_label, body, text) => {
    stubMeta();
    stubXHR({ status: 400, body });
    await startWith();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(text));
  });

  it("falls back to a general message when the refusal is not JSON", async () => {
    stubMeta();
    stubXHR({ status: 502 });
    FakeXHR.rawBody = "Bad gateway";
    await startWith();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The import could not be started."));
  });

  it("counts several conflicts the server found, and none it did not name", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: {
        error: {
          code: "document_import_conflict",
          message: "Exists.",
          details: { conflicts: [{ filename: "a.pdf" }, { filename: "b.pdf" }, { other: 1 }] },
        },
      },
    });
    await startWith("a.pdf");

    expect(await screen.findByText(/2 pages with the same names already exist/)).toBeInTheDocument();
  });

  it("offers the general conflict wording when the server names no file", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: { error: { code: "document_import_conflict", message: "Exists.", details: {} } },
    });
    await startWith("a.pdf");

    expect(await screen.findByRole("heading", { name: "Page already exists" })).toBeInTheDocument();
  });

  it("closes the dialog and tells the caller when a finished import is dismissed", async () => {
    stubMeta();
    stubXHR({
      body: {
        id: "job-1",
        space_key: "ENG",
        status: "complete",
        phase: "done",
        counters: { items_total: 1, items_processed: 1, pages_created: 1, items_failed: 0 },
        cancel_requested: false,
        error: null,
        percent: 100,
        eta_seconds: 0,
        items: [],
      },
    });
    const onDismiss = vi.fn();
    const onFinished = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPagesDialog
        spaceKey="ENG"
        onStarted={vi.fn()}
        onDismiss={onDismiss}
        onFinished={onFinished}
      />,
    );
    await user.click(screen.getByRole("button", { name: /import/i }));
    await screen.findByRole("dialog");
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    const summary = await screen.findAllByRole("dialog");
    await user.click(within(summary[summary.length - 1]).getByRole("button", { name: /done/i }));
    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("ImportPagesDialog refusals without a message", () => {
  async function importOne() {
    const { user } = await openDialog();
    await choose([file("a.pdf")]);
    await screen.findByText("a.pdf");
    await user.click(screen.getByRole("button", { name: /^import$/i }));
  }

  it("uses the general wording when the refusal names nothing", async () => {
    stubMeta();
    stubXHR({ status: 400, body: {} });
    await importOne();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The import could not be started."));
  });

  it("speaks of this file when the server reports a conflict without naming it", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: {
        error: {
          code: "document_import_conflict",
          message: "Exists.",
          details: { conflicts: [{ filename: "" }] },
        },
      },
    });
    await importOne();

    expect(await screen.findByText(/this file/i)).toBeInTheDocument();
  });
});
