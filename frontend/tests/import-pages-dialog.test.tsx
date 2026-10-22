import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const ai = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock("@/lib/ai-summary", () => ({
  aiStatus: () =>
    Promise.resolve({ enabled: ai.enabled(), can_configure: false }),
  resetAiStatus: () => {},
}));

import { ImportPagesDialog } from "@/components/pages/import-pages-dialog";

beforeEach(() => {
  ai.enabled.mockReturnValue(true);
});

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
  FakeXHR.responseBody = JSON.stringify(
    options.body ?? { id: "job-1", items: [] },
  );
  FakeXHR.failWith = options.fail ?? null;
  FakeXHR.hold = false;
  FakeXHR.rawBody = null;
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
}

function stubMeta(maxUploadBytes = 50 * 1024 * 1024) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ max_upload_size_bytes: maxUploadBytes }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
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
    expect(
      within(dialog).getByRole("button", { name: /^import$/i }),
    ).toBeDisabled();
  });

  it("rejects an unsupported file inline, beside the file it means", async () => {
    // A toast here would leave the user guessing which of ten files was wrong.
    stubMeta();
    stubXHR();
    await openDialog();
    await choose([file("payload.exe")]);

    expect(await screen.findByText(/cannot import \.exe/i)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /^import$/i }),
    ).toBeDisabled();
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
    expect(
      within(dialog).getByRole("button", { name: /^import$/i }),
    ).toBeEnabled();
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
    // Each page is reviewed against its file unless that has been turned off.
    expect(sent.get("review")).toBe("true");
  });

  it("reviews each page by default, and remembers when that is turned off", async () => {
    window.localStorage.removeItem("wikihub:import-review");
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    const box = screen.getByRole("checkbox", {
      name: /review with ai after importing/i,
    });
    expect(box).toBeChecked();
    // A short line is always there; the long account comes with the info button.
    expect(
      screen.getByText(/checks each page against the original/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/headings, lists, tables, lost text/i),
    ).not.toBeInTheDocument();
    await user.hover(
      within(box.closest("label")!).getByRole("button", { name: /more info/i }),
    );
    expect(
      await screen.findAllByText(/headings, lists, tables, lost text/i),
    ).not.toHaveLength(0);
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem("wikihub:import-review")).toBe("false");

    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("review")).toBe("false");
    window.localStorage.removeItem("wikihub:import-review");
  });

  it("keeps the document's own language unless a translation is chosen", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    // Nothing is translated by default.
    const select = screen.getByRole("button", {
      name: /language to translate/i,
    });
    expect(select).toHaveTextContent("Original language");
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("translate")).toBe("");
  });

  it("turns the review and the translation off when the AI assistant is not set up", async () => {
    ai.enabled.mockReturnValue(false);
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    // Neither can be used: the switch and the language list are disabled, with the reason.
    const select = await screen.findByRole("button", {
      name: /language to translate/i,
    });
    await waitFor(() => expect(select).toBeDisabled());
    const box = screen.getByRole("checkbox", { name: /review with ai/i });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(
      screen.getAllByText(/needs the AI assistant, which is not set up/i),
    ).toHaveLength(2);
    // Both rows look switched off, not only the controls in them.
    expect(box.closest("label")!.className).toContain("opacity-60");
    expect(
      select.closest("div.opacity-60, div[class*='opacity-60']"),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("translate")).toBe("");
    // Not asked for either, whatever was remembered from when the assistant was on.
    expect(FakeXHR.last!.body!.get("review")).toBe("false");
  });

  it("sends the language chosen to translate the pages into", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");

    await user.click(
      screen.getByRole("button", { name: /language to translate/i }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Tiếng Việt" }),
    );
    expect(
      screen.getByRole("button", { name: /language to translate/i }),
    ).toHaveTextContent("Tiếng Việt");
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("translate")).toBe("vi");
  });

  it("names English as the language chosen, and works with storage that refuses", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      stubMeta();
      stubXHR();
      const { user } = await openDialog();
      await choose([file("a.docx")]);
      await screen.findByText("a.docx");

      // The review is on when it cannot be read back, and turning it off is not kept.
      const box = screen.getByRole("checkbox", {
        name: /review with ai after importing/i,
      });
      expect(box).toBeChecked();
      await user.click(box);
      expect(box).not.toBeChecked();

      await user.click(
        screen.getByRole("button", { name: /language to translate/i }),
      );
      await user.click(
        await screen.findByRole("menuitemradio", { name: "English" }),
      );
      expect(
        screen.getByRole("button", { name: /language to translate/i }),
      ).toHaveTextContent("English");
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("starts with the review off when it was turned off before", async () => {
    window.localStorage.setItem("wikihub:import-review", "false");
    stubMeta();
    stubXHR();
    await openDialog();

    expect(
      screen.getByRole("checkbox", { name: /review with ai/i }),
    ).not.toBeChecked();
    window.localStorage.removeItem("wikihub:import-review");
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
    expect(
      screen.getByRole("button", { name: "Cancel import" }),
    ).toBeInTheDocument();
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

    expect(
      await screen.findByRole("heading", { name: "Page already exists" }),
    ).toBeInTheDocument();
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

    expect(
      await screen.findByRole("heading", { name: "Page already exists" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/matching “a \(1\)” already exists/i),
    ).toBeInTheDocument();
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
      expect(toast.error).toHaveBeenCalledWith(
        "A WikiHub restore is still running.",
      ),
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

    expect(
      await screen.findByRole("heading", { name: "Page already exists" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/matching “a” already exists/i),
    ).toBeInTheDocument();
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
    expect(
      screen.queryByRole("heading", { name: "Page already exists" }),
    ).not.toBeInTheDocument();
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

  it("accepts Excel and CSV files", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    await choose([file("budget.xlsx"), file("people.csv")]);

    expect(await screen.findByText("budget.xlsx")).toBeInTheDocument();
    expect(screen.queryByText(/cannot import/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import 2 files/i }),
    ).toBeEnabled();
  });

  it("imports a Google Sheets link on its own", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    const link =
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0";

    await user.type(screen.getByLabelText("Google Sheets or Docs link"), link);
    expect(screen.getByText(/a google sheet ready/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    const sent = FakeXHR.last!.body!;
    expect(sent.get("google_url")).toBe(link);
    expect(sent.getAll("files")).toHaveLength(0);
  });

  it("imports a Google Docs link and names it as a doc", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    const link =
      "https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit";

    await user.type(screen.getByLabelText("Google Sheets or Docs link"), link);
    expect(screen.getByText(/a google doc ready/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.get("google_url")).toBe(link);
  });

  it("sends a Google Sheets link together with chosen files", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");
    await user.type(
      screen.getByLabelText("Google Sheets or Docs link"),
      "docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    );

    await user.click(screen.getByRole("button", { name: /import 2 files/i }));

    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.body!.getAll("files")).toHaveLength(1);
    expect(FakeXHR.last!.body!.get("google_url")).toContain("docs.google.com");
  });

  it("refuses a link that is not a Google Sheet, even beside valid files", async () => {
    stubMeta();
    stubXHR();
    const { user } = await openDialog();
    await choose([file("a.docx")]);
    await screen.findByText("a.docx");
    const input = screen.getByLabelText("Google Sheets or Docs link");

    await user.type(input, "https://example.com/sheet");

    expect(
      screen.getByText(/not a google sheets or google docs link/i),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: /clear the google link/i }),
    );
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled();
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
    expect(toast.error).toHaveBeenCalledWith(
      "Import at most 20 documents at a time.",
    );
  });

  it("takes files dropped on the drop zone", async () => {
    stubMeta();
    stubXHR();
    await openDialog();
    const zone = document.querySelector("#import-files")!.parentElement!;

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("border-primary bg-primary/10");
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

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The server sent a response WikiHub could not read.",
      ),
    );
  });

  it.each([
    ["a plain detail", { detail: "Plain detail." }, "Plain detail."],
    ["a top-level message", { message: "Top message." }, "Top message."],
    [
      "an unusable message",
      { detail: { message: 42 } },
      "The import could not be started.",
    ],
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

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The import could not be started.",
      ),
    );
  });

  it("counts several conflicts the server found, and none it did not name", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: {
        error: {
          code: "document_import_conflict",
          message: "Exists.",
          details: {
            conflicts: [
              { filename: "a.pdf" },
              { filename: "b.pdf" },
              { other: 1 },
            ],
          },
        },
      },
    });
    await startWith("a.pdf");

    expect(
      await screen.findByText(/2 pages with the same names already exist/),
    ).toBeInTheDocument();
  });

  it("offers the general conflict wording when the server names no file", async () => {
    stubMeta();
    stubXHR({
      status: 409,
      body: {
        error: {
          code: "document_import_conflict",
          message: "Exists.",
          details: {},
        },
      },
    });
    await startWith("a.pdf");

    expect(
      await screen.findByRole("heading", { name: "Page already exists" }),
    ).toBeInTheDocument();
  });

  it("closes the dialog and tells the caller when a finished import is dismissed", async () => {
    stubMeta();
    stubXHR({
      body: {
        id: "job-1",
        space_key: "ENG",
        status: "complete",
        phase: "done",
        counters: {
          items_total: 1,
          items_processed: 1,
          pages_created: 1,
          items_failed: 0,
        },
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
    await user.click(
      within(summary[summary.length - 1]).getByRole("button", {
        name: /done/i,
      }),
    );
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

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The import could not be started.",
      ),
    );
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
