import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoragePanel } from "@/components/admin/storage-panel";
import { apiFetch } from "@/lib/api-client";
import type { StorageObject } from "@/types/api";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/components/admin/office-preview-viewer", () => ({
  OfficePreviewViewer: ({ storageKey }: { storageKey: string }) => (
    <div data-testid="office-viewer">{storageKey}</div>
  ),
}));

const mockedFetch = vi.mocked(apiFetch);

function object(key: string, overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    key,
    size: 1024,
    etag: null,
    last_modified: "2026-01-02T03:04:05Z",
    kind: "page_attachment",
    space_id: "s1",
    space_name: "Engineering",
    page_id: "p1",
    page_title: "Runbook",
    ...overrides,
  };
}

const OBJECTS: StorageObject[] = [
  object("attachments/p1/diagram.png", { size: 2048 }),
  object("attachments/p1/notes.md", { size: 10 }),
  object("attachments/p2/report.docx", { page_id: "p2", page_title: "Report", last_modified: null }),
  object("attachments/p3/song.mp3", { space_id: "s2", space_name: "Ops", page_id: "p3", page_title: "Audio" }),
  object("attachments/p3/clip.mp4", { space_id: "s2", space_name: "Ops", page_id: "p3", page_title: "Audio" }),
  object("avatars/u1.jpg", { kind: "avatar", space_id: null, space_name: null, page_id: null, page_title: null }),
  object("imports/archive.zip", { kind: "import_archive", size: 5 * 1024 * 1024, space_id: null, space_name: null, page_id: null, page_title: null }),
  object("misc/blob.bin", { kind: "other", size: 0, space_id: null, space_name: null, page_id: null, page_title: null }),
  object("misc/Dockerfile", { kind: "other", space_id: null, space_name: null, page_id: null, page_title: null }),
  object("/", { kind: "other" }),
  object("top-level.txt", { kind: "mystery" as never, space_id: null, space_name: null, page_id: null, page_title: null }),
];

function serve(objects: StorageObject[] = OBJECTS) {
  mockedFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/v1/storage") return objects;
    if (path.startsWith("/api/v1/storage/presign")) return { url: `https://s3.test/${path.length}`, key: "k" };
    if (init?.method === "DELETE") return { key: "k", archive_cleared: false, attachment_deleted: false };
    throw new Error(`unexpected ${path}`);
  });
}

async function renderPanel() {
  const actor = userEvent.setup();
  render(<StoragePanel />);
  await screen.findByText("Name / Path");
  await waitFor(() => expect(screen.queryByText("Loading storage objects…")).toBeNull());
  return actor;
}

async function openFolder(actor: ReturnType<typeof userEvent.setup>, name: string) {
  await actor.click(screen.getByRole("button", { name: new RegExp(`^${name}\\b`) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  serve();
});

afterEach(() => vi.unstubAllGlobals());

describe("StoragePanel overview", () => {
  it("summarises the bucket and filters by kind from the cards", async () => {
    const actor = await renderPanel();

    const total = screen.getByRole("button", { name: /Total/ });
    expect(total).toHaveTextContent("11 objects");
    expect(total).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Avatars/ })).toHaveTextContent("1 object");

    await actor.click(screen.getByRole("button", { name: /Avatars/ }));
    expect(screen.getByRole("button", { name: /Avatars/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^attachments/ })).toBeNull();
    await actor.click(screen.getByRole("button", { name: /Avatars/ }));
    await actor.click(screen.getByRole("button", { name: /Avatars/ }));
    await actor.click(total);
    expect(screen.getByRole("button", { name: /^attachments/ })).toBeInTheDocument();
  });

  it("shows the load error instead of the overview, and refreshes", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("Bucket unreachable."));
    const actor = await renderPanel();

    expect(screen.getByText("Bucket unreachable.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Total/ })).toBeNull();

    mockedFetch.mockRejectedValueOnce("odd failure");
    await actor.click(screen.getByRole("button", { name: "Refresh storage list" }));
    expect(await screen.findByText("Could not load storage objects.")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Refresh storage list" }));
    expect(await screen.findByRole("button", { name: /^attachments/ })).toBeInTheDocument();
  });

  it("says when the bucket is empty, or nothing matches the search", async () => {
    serve([]);
    const actor = await renderPanel();
    expect(screen.getByText("The bucket is empty.")).toBeInTheDocument();

    await actor.type(screen.getByLabelText("Filter storage objects"), "x");
    expect(screen.getByText("No objects match your filter.")).toBeInTheDocument();
  });
});

describe("StoragePanel tree", () => {
  it("starts collapsed and expands folders with their totals, folders first", async () => {
    const actor = await renderPanel();

    const attachments = screen.getByRole("button", { name: /^attachments/ });
    expect(attachments).toHaveAttribute("aria-expanded", "false");
    expect(attachments).toHaveTextContent("5 files");
    expect(screen.getByRole("button", { name: /^misc/ })).toHaveTextContent("2 files · 1.0 KB");
    await openFolder(actor, "attachments");
    await openFolder(actor, "p1");

    const row = (name: string) => screen.getByText(name).parentElement as HTMLElement;
    expect(row("diagram.png")).toHaveTextContent("2.0 KB");
    expect(row("notes.md")).toHaveTextContent("10 B");
    await openFolder(actor, "p2");
    expect(row("report.docx")).toHaveTextContent("—");
    await openFolder(actor, "misc");
    expect(row("blob.bin")).toHaveTextContent("0 B");
    await openFolder(actor, "imports");
    expect(row("archive.zip")).toHaveTextContent("5.0 MB");
    await openFolder(actor, "p1");
    expect(screen.queryByText("diagram.png")).toBeNull();
  });

  it("searches paths, keeping matching folders open to their files", async () => {
    const actor = await renderPanel();

    await actor.type(screen.getByLabelText("Filter storage objects"), "NOTES");
    expect(screen.queryByRole("button", { name: /^avatars/ })).toBeNull();
    await openFolder(actor, "attachments");
    expect(screen.queryByRole("button", { name: /^p2/ })).toBeNull();

    await actor.clear(screen.getByLabelText("Filter storage objects"));
    await actor.type(screen.getByLabelText("Filter storage objects"), "misc");
    expect(screen.getByRole("button", { name: /^misc/ })).toBeInTheDocument();
  });
});

describe("StoragePanel filters", () => {
  async function openFilter(actor: ReturnType<typeof userEvent.setup>, label: string) {
    await actor.click(screen.getByRole("button", { name: `Filter by ${label}` }));
  }

  it("filters by space, then narrows the pages to that space", async () => {
    const actor = await renderPanel();

    await openFilter(actor, "space");
    await actor.click(screen.getByRole("checkbox", { name: "Ops" }));
    await actor.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Filter by space" })).toHaveTextContent("Ops");
    expect(screen.queryByRole("button", { name: /^avatars/ })).toBeNull();

    await openFilter(actor, "page");
    expect(screen.queryByRole("checkbox", { name: "Runbook" })).toBeNull();
    await actor.click(screen.getByRole("checkbox", { name: "Audio" }));
    await actor.keyboard("{Escape}");
    await openFolder(actor, "attachments");
    expect(screen.getByRole("button", { name: /^p3/ })).toBeInTheDocument();
  });

  it("selects several types, searches options, and clears back to all", async () => {
    const actor = await renderPanel();

    await openFilter(actor, "type");
    await actor.click(screen.getByRole("checkbox", { name: "Avatars" }));
    await actor.click(screen.getByRole("checkbox", { name: "Other objects" }));
    expect(screen.getByRole("button", { name: "Filter by type" })).toHaveTextContent("2 selected");
    await actor.click(screen.getByRole("checkbox", { name: "Other objects" }));
    await actor.type(screen.getByLabelText("Search type options"), "zzz");
    expect(screen.getByText("No matching options.")).toBeInTheDocument();
    await actor.click(screen.getByRole("checkbox", { name: "All types" }));
    await actor.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Filter by type" })).toHaveTextContent("All types");
    await openFilter(actor, "type");
    expect(screen.getByLabelText("Search type options")).toHaveValue("");
  });

  it("labels an unknown single selection with the 'all' text", async () => {
    const actor = await renderPanel();

    await openFilter(actor, "space");
    await actor.click(screen.getByRole("checkbox", { name: "Ops" }));
    await actor.keyboard("{Escape}");
    await openFilter(actor, "page");
    await actor.click(screen.getByRole("checkbox", { name: "Audio" }));
    await actor.keyboard("{Escape}");
    // Switching space clears the page filter.
    await openFilter(actor, "space");
    await actor.click(screen.getByRole("checkbox", { name: "Engineering" }));
    await actor.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Filter by page" })).toHaveTextContent("All pages");
  });
});

describe("StoragePanel actions", () => {
  it("downloads through a presigned link", async () => {
    const actor = await renderPanel();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await openFolder(actor, "avatars");
    await actor.click(screen.getByRole("button", { name: "Download u1.jpg" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith("/api/v1/storage/presign?key=avatars%2Fu1.jpg");
  });

  it("reports a download link that could not be made", async () => {
    const actor = await renderPanel();
    await openFolder(actor, "avatars");

    mockedFetch.mockRejectedValueOnce(new Error("Signing failed."));
    await actor.click(screen.getByRole("button", { name: "Download u1.jpg" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Signing failed."));

    mockedFetch.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Download u1.jpg" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not generate download URL."),
    );
  });

  it("deletes an object after confirming, naming what else was cleaned up", async () => {
    const actor = await renderPanel();
    mockedFetch.mockImplementationOnce(async () => ({
      key: "k",
      archive_cleared: true,
      attachment_deleted: true,
    }));

    await actor.click(screen.getByRole("button", { name: "Delete top-level.txt" }));
    expect(screen.getByRole("dialog", { name: "Delete object?" })).toHaveTextContent("top-level.txt");
    await actor.click(screen.getByRole("button", { name: /Delete permanently/ }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Deleted top-level.txt (archive hash cleared, attachment record removed)",
      ),
    );
    expect(screen.queryByText("top-level.txt")).toBeNull();
  });

  it("deletes without extras, reports failures, and can be cancelled", async () => {
    const actor = await renderPanel();
    await openFolder(actor, "avatars");

    await actor.click(screen.getByRole("button", { name: "Delete u1.jpg" }));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await actor.click(screen.getByRole("button", { name: "Delete u1.jpg" }));
    mockedFetch.mockRejectedValueOnce(new Error("Locked."));
    await actor.click(screen.getByRole("button", { name: /Delete permanently/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Locked."));
    mockedFetch.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: /Delete permanently/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete the object."));

    await actor.click(screen.getByRole("button", { name: /Delete permanently/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted u1.jpg"));
  });
});

describe("StoragePanel previews", () => {
  async function preview(path: string[], name: string) {
    const actor = await renderPanel();
    for (const folder of path) await openFolder(actor, folder);
    await actor.click(screen.getByRole("button", { name: `Preview ${name}` }));
    return actor;
  }

  it("shows an image", async () => {
    await preview(["attachments", "p1"], "diagram.png");
    expect(await screen.findByRole("img", { name: "diagram.png" })).toHaveAttribute(
      "src",
      expect.stringMatching(/^https:\/\/s3\.test\//),
    );
  });

  it("plays video and audio with a type guessed from the name", async () => {
    const actor = await preview(["attachments", "p3"], "clip.mp4");
    const video = await screen.findByLabelText("Preview video: clip.mp4");
    expect(video.querySelector("source")).toHaveAttribute("type", "video/mp4");
    await actor.keyboard("{Escape}");

    await actor.click(screen.getByRole("button", { name: "Preview song.mp3" }));
    const audio = await screen.findByLabelText("Preview audio: song.mp3");
    expect(audio.querySelector("source")).toHaveAttribute("type", "audio/mpeg");
  });

  it("hands office documents to the document viewer", async () => {
    await preview(["attachments", "p2"], "report.docx");
    expect(await screen.findByTestId("office-viewer")).toHaveTextContent(
      "attachments/p2/report.docx",
    );
  });

  it("shows text with line numbers and syntax colours", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("# Title\n\nbody", { status: 200 })),
    );
    await preview(["attachments", "p1"], "notes.md");

    const code = await screen.findByText("3");
    expect(code.closest(".wikihub-code")).toHaveTextContent("Title");
  });

  it("shows plain text without a known language", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("FROM node\n", { status: 200 })));
    await preview(["misc"], "Dockerfile");

    expect(await screen.findByText("FROM node")).toBeInTheDocument();
  });

  it("explains a text file that could not be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await preview([], "top-level.txt");

    expect(await screen.findByText("Could not load the file content.")).toBeInTheDocument();
  });

  it("explains a preview link that could not be made", async () => {
    const actor = await renderPanel();
    await openFolder(actor, "avatars");
    mockedFetch.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Preview u1.jpg" }));

    expect(await screen.findByText("Could not load the preview.")).toBeInTheDocument();
  });

  it("says so for a file type it cannot show, and downloads it instead", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const actor = await renderPanel();
    await openFolder(actor, "misc");
    await actor.click(screen.getByRole("button", { name: "blob.bin" }));

    expect(screen.getByText("Preview is not available")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Download file" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
  });

  it("ignores a preview that arrives after switching to another file", async () => {
    let release: (value: { url: string; key: string }) => void = () => {};
    const actor = await renderPanel();
    await openFolder(actor, "avatars");
    mockedFetch.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    await actor.click(screen.getByRole("button", { name: "Preview u1.jpg" }));
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    release({ url: "https://s3.test/late", key: "k" });
    await actor.click(screen.getByRole("button", { name: "Preview top-level.txt" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("img")).toBeNull();
  });
});
