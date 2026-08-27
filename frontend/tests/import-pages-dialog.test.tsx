import { act, render, screen, waitFor, within } from "@testing-library/react";
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
      this.responseText = FakeXHR.responseBody;
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

  it("hands the queued job to its caller and closes", async () => {
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
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
