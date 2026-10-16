import { createHash, webcrypto } from "node:crypto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import {
  CONFLUENCE_ARCHIVE,
  FakeUploadXHR,
  baseRoutes,
  confluenceExportZip,
  mockFetch,
  stubUploadXHR,
  type Route,
} from "./backup-panel-harness";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const METADATA_KEY = "wikihub-confluence-upload-current";
const PART = 64;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", {
    subtle: { digest: (algorithm: string, data: BufferSource) => webcrypto.subtle.digest(algorithm, data) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
});

const sha = async (file: File) => createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");

function progress(file: File, overrides: Record<string, unknown> = {}) {
  return {
    archive_id: "conf-1",
    filename: file.name,
    size_bytes: file.size,
    sha256: null,
    status: "uploading",
    part_size_bytes: PART,
    uploaded_parts: [1],
    ...overrides,
  };
}

function saveMetadata(file: File, sha256: string | null) {
  window.localStorage.setItem(
    METADATA_KEY,
    JSON.stringify({
      archiveId: "conf-1",
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      sha256,
      partSize: PART,
    }),
  );
}

const resumeRoutes = (file: File, serverProgress: Record<string, unknown>, extra: Route[] = []): Route[] => [
  ...extra,
  {
    method: "GET",
    match: (p) => p === "/api/v1/confluence-imports/uploads/active",
    handler: () => ({ body: [progress(file, serverProgress)] }),
  },
  {
    method: "GET",
    match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
    handler: () => ({ body: progress(file, serverProgress) }),
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload-parts",
    handler: () => ({ body: { urls: { "2": "http://localhost/part2", "3": "http://localhost/part3" } } }),
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/complete-upload",
    handler: () => ({ body: {} }),
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/scan",
    handler: () => ({ body: CONFLUENCE_ARCHIVE }),
  },
];

async function openPanel(routes: Route[]) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup({ applyAccept: false });
  render(<BackupPanel />);
  await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
  await screen.findByRole("button", { name: /select file to resume/i });
  return user;
}

const input = () => document.getElementById("confluence-backup-file") as HTMLInputElement;

describe("resuming a Confluence upload", () => {
  const file = confluenceExportZip("conf.zip");

  it("sends only the parts the server does not have yet, then scans", async () => {
    stubUploadXHR();
    saveMetadata(file, await sha(file));
    const user = await openPanel(resumeRoutes(file, { sha256: await sha(file) }));

    await user.upload(input(), file);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive scanned. Choose the Spaces to import."), {
      timeout: 5000,
    });
  });

  it("refuses a file whose fingerprint differs from the one saved with the upload", async () => {
    stubUploadXHR();
    saveMetadata(file, "0".repeat(64));
    const user = await openPanel(resumeRoutes(file, { sha256: "0".repeat(64) }));

    await user.upload(input(), file);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`Select ${file.name} to resume the paused upload.`),
    );
  });

  it("refuses a file whose fingerprint differs from the one the server holds", async () => {
    stubUploadXHR();
    saveMetadata(file, null);
    const user = await openPanel(resumeRoutes(file, { sha256: "f".repeat(64) }));

    await user.upload(input(), file);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`Select ${file.name} to resume the paused upload.`),
    );
  });

  it("carries on to scanning when the server already has every part", async () => {
    stubUploadXHR();
    saveMetadata(file, await sha(file));
    // Still uploading when the page loads, finished by the time the file is handed back.
    let looks = 0;
    const user = await openPanel(
      resumeRoutes(file, { sha256: await sha(file) }, [
        {
          method: "GET",
          match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
          handler: async () => ({
            body: progress(file, { sha256: await sha(file), status: ++looks > 1 ? "uploaded" : "uploading" }),
          }),
        },
      ]),
    );

    await user.upload(input(), file);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Archive already uploaded. Choose the Spaces to import."),
    );
  });

  it("pauses an upload in flight, and says it can be resumed", async () => {
    stubUploadXHR({ hold: true });
    saveMetadata(file, await sha(file));
    const user = await openPanel(resumeRoutes(file, { sha256: await sha(file) }));

    await user.upload(input(), file);
    await user.click(await screen.findByRole("button", { name: /pause upload/i }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Upload paused")));
  });

  it("cancels an upload after asking, and says when the server could not discard it", async () => {
    stubUploadXHR({ hold: true });
    saveMetadata(file, await sha(file));
    const user = await openPanel(
      resumeRoutes(file, { sha256: await sha(file) }, [
        {
          method: "DELETE",
          match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
          handler: () => ({ status: 500, body: { error: { code: "x", message: "Storage unreachable." } } }),
        },
      ]),
    );

    await user.upload(input(), file);
    await user.click(await screen.findByRole("button", { name: /^cancel upload$/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^cancel upload$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Storage unreachable."));
    expect(window.localStorage.getItem(METADATA_KEY)).toBeNull();
  });

  it("cancels an upload and confirms it was discarded", async () => {
    stubUploadXHR({ hold: true });
    saveMetadata(file, await sha(file));
    const user = await openPanel(
      resumeRoutes(file, { sha256: await sha(file) }, [
        {
          method: "DELETE",
          match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
          handler: () => ({ body: {} }),
        },
      ]),
    );

    await user.upload(input(), file);
    await user.click(await screen.findByRole("button", { name: /^cancel upload$/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^cancel upload$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Confluence archive upload cancelled."));
  });

  it("pauses with a clear message when the session lapses mid-upload", async () => {
    stubUploadXHR({ hold: true });
    saveMetadata(file, await sha(file));
    let renewals = 0;
    const user = await openPanel(
      resumeRoutes(file, { sha256: await sha(file) }, [
        {
          method: "POST",
          match: (p) => p === "/api/v1/auth/renew",
          handler: () =>
            ++renewals > 3
              ? { status: 401, body: { error: { code: "unauthenticated", message: "Expired." } } }
              : { body: {} },
        },
      ]),
    );

    await user.upload(input(), file);
    await screen.findByRole("button", { name: /pause upload/i });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      for (let i = 0; i < 4; i += 1) document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Upload paused because your session expired."));
  });
});

describe("page-level safeguards", () => {
  it("asks the browser to confirm leaving while an upload is in flight, and not otherwise", async () => {
    stubUploadXHR({ hold: true });
    const file = confluenceExportZip("conf.zip");
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/uploads",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            object_key: "k",
            max_size_bytes: 9999,
            part_size_bytes: PART,
            uploaded_parts: [],
            status: "uploading",
            sha256: null,
            reused: false,
          },
        }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload-parts",
        handler: () => ({ body: { urls: { "1": "http://localhost/p1" } } }),
      },
      ...baseRoutes(),
    ]);
    const user = userEvent.setup({ applyAccept: false });
    render(<BackupPanel />);
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const idle = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    await user.upload(input(), file);
    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);
    await screen.findByRole("button", { name: /pause upload/i });

    const busy = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
  });

  it("keeps the session alive when the tab regains focus or becomes visible", async () => {
    let renewals = 0;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/auth/renew",
        handler: () => {
          renewals += 1;
          return { body: {} };
        },
      },
      ...baseRoutes(),
    ]);
    render(<BackupPanel />);
    await waitFor(() => expect(renewals).toBeGreaterThan(0));
    const before = renewals;

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(renewals).toBeGreaterThan(before));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const hidden = renewals;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(renewals).toBe(hidden);
  });

  it("looks for unfinished work again when the tab returns or storage changes", async () => {
    let looks = 0;
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs",
        handler: () => {
          looks += 1;
          return { body: [] };
        },
      },
      ...baseRoutes(),
    ]);
    render(<BackupPanel />);
    await waitFor(() => expect(looks).toBeGreaterThan(0));
    const before = looks;

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new StorageEvent("storage", { key: METADATA_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });
    await waitFor(() => expect(looks).toBeGreaterThanOrEqual(before + 2));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const hidden = looks;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(looks).toBe(hidden);
  });
});

void fireEvent;
void FakeUploadXHR;
