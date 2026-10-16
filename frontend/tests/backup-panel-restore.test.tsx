import { webcrypto } from "node:crypto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import {
  RESTORE_ARCHIVE,
  baseRoutes,
  mockFetch,
  restoreUploadRoutes,
  stubUploadXHR,
  wikihubBackupZip,
  confluenceExportZip,
  type Route,
} from "./backup-panel-harness";

const refresh = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  window.localStorage.clear();
  refresh.mockReset();
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

const card = () => within(screen.getByTestId("wikihub-restore-card"));
const input = () => document.getElementById("backup-file") as HTMLInputElement;

async function openPanel(routes: Route[] = []) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup({ applyAccept: false });
  render(<BackupPanel />);
  await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
  await waitFor(() => expect(input()).not.toBeNull());
  return user;
}

const uploadAndScan = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(card().getByRole("button", { name: /^upload and scan$/i }));

describe("WikiHub restore upload failures", () => {
  it("reports a part that object storage rejected", async () => {
    stubUploadXHR({ status: 403 });
    const user = await openPanel(restoreUploadRoutes());
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    expect(await card().findByText("Could not upload or scan the backup archive.")).toBeInTheDocument();
    expect(await screen.findByText(/Failed to upload or scan the archive\./)).toBeInTheDocument();
  });

  it("reports a part that could not be sent at all", async () => {
    stubUploadXHR({ fail: "error" });
    const user = await openPanel(restoreUploadRoutes());
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    expect(await card().findByText("Could not upload or scan the backup archive.")).toBeInTheDocument();
  });

  it("tells a session that expired apart from other failures", async () => {
    stubUploadXHR();
    const user = await openPanel(
      restoreUploadRoutes({
        start: () => ({ status: 401, body: { error: { code: "unauthenticated", message: "Expired." } } }),
      }),
    );
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Upload paused because your session expired."));
    expect(await screen.findByText(/Upload paused: Your session expired\./)).toBeInTheDocument();
  });

  it("shows the server's reason when the scan fails for a reason that may pass", async () => {
    stubUploadXHR();
    const user = await openPanel(
      restoreUploadRoutes({
        scan: () => ({ status: 503, body: { error: { code: "busy", message: "Scanner is busy." } } }),
      }),
    );
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    expect(await card().findByText("Scanner is busy.")).toBeInTheDocument();
    expect(card().queryByRole("button", { name: /upload another file/i })).toBeNull();
  });

  it("pauses with a clear message when the session lapses mid-upload", async () => {
    stubUploadXHR({ hold: true });
    let renewals = 0;
    const user = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/auth/renew",
        handler: () =>
          ++renewals > 3
            ? { status: 401, body: { error: { code: "unauthenticated", message: "Expired." } } }
            : { body: {} },
      },
      ...restoreUploadRoutes(),
    ]);
    await user.upload(input(), wikihubBackupZip("backup.zip"));
    await uploadAndScan(user);
    await card().findByRole("button", { name: /pause upload/i });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      for (let i = 0; i < 4; i += 1) document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(await card().findByText(/session expired while uploading/i)).toBeInTheDocument();
  });

  it("copes with an empty archive and with progress that has not started", async () => {
    stubUploadXHR();
    const user = await openPanel(restoreUploadRoutes());
    await user.upload(input(), new File([], "empty.zip", { type: "application/zip" }));

    await uploadAndScan(user);

    await waitFor(() => expect(card().queryByRole("button", { name: /pause upload/i })).toBeNull());
  });
});

describe("WikiHub restore", () => {
  async function scanned(extra: Route[] = []) {
    stubUploadXHR();
    const user = await openPanel([...extra, ...restoreUploadRoutes()]);
    await user.upload(input(), wikihubBackupZip("backup.zip"));
    await uploadAndScan(user);
    // The space picker opens on its own once the archive has been scanned.
    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 5000 });
    return user;
  }

  it("reports a restore that could not be queued", async () => {
    const user = await scanned([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: () => ({ status: 409, body: { error: { code: "busy", message: "A restore is already running." } } }),
      },
    ]);

    await user.click(await screen.findByRole("checkbox", { name: /Engineering/ }));
    await user.click(screen.getByRole("button", { name: /start restore/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A restore is already running."));
  });

  it("asks before replacing spaces that already exist, listing more than eight", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `K${i}`,
      name: `Space ${i}`,
      page_count: 1,
      conflict: true,
    }));
    const user = await scanned([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/scan",
        handler: () => ({ body: { ...RESTORE_ARCHIVE, spaces: many } }),
      },
    ]);

    await user.click(await screen.findByRole("button", { name: /^select all$/i }));
    await user.click(screen.getByRole("button", { name: /start restore/i }));

    expect(await screen.findByText(/and 2 more/)).toBeInTheDocument();
  });

  it("clears the archive selection and reports one the server could not discard", async () => {
    const user = await scanned([
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Storage unreachable." } } }),
      },
    ]);

    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /^cancel restore$/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel restore" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Storage unreachable."));
  });
});

describe("JSON restore", () => {
  const jsonFile = () => new File(['{"wikihub_backup":{}}'], "backup.json", { type: "application/json" });

  it("applies a backup file and refreshes the page", async () => {
    const user = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/import",
        handler: () => ({
          body: {
            dry_run: false,
            includes_credentials: false,
            created: { page: 2 },
            skipped: {},
            errors: {},
            users_without_password: [],
            entries: [],
          },
        }),
      },
    ]);
    await user.upload(input(), jsonFile());

    await user.click(card().getByRole("button", { name: /restore backup/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Import applied."));
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText("Import result")).toBeInTheDocument();
    expect(screen.queryByText(/Per-item detail/)).toBeNull();
    expect(screen.queryByText(/cannot sign in yet/)).toBeNull();
  });

  it("reports a file the server cannot read", async () => {
    const user = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/import",
        handler: () => ({ status: 400, body: { error: { code: "bad", message: "Not a WikiHub backup." } } }),
      },
    ]);
    await user.upload(input(), jsonFile());

    await user.click(card().getByRole("button", { name: /restore backup/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not a WikiHub backup."));
  });
});

describe("restore card file checks", () => {
  it("refuses a Confluence export in the restore card", async () => {
    const user = await openPanel();

    await user.upload(input(), confluenceExportZip("conf.zip"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("This is a Confluence export")),
    );
    void fireEvent;
  });
});

describe("WikiHub restore in between steps", () => {
  it("says the archive is being scanned once every part is up", async () => {
    stubUploadXHR();
    let release: (value: { body: unknown }) => void = () => {};
    const gate = new Promise<{ body: unknown }>((resolve) => (release = resolve));
    const user = await openPanel(restoreUploadRoutes({ scan: () => gate }));
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    expect(await screen.findByText("Upload complete. Scanning the archive…")).toBeInTheDocument();
    release({ body: RESTORE_ARCHIVE });
    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 5000 });
  });

  it("explains how much of an earlier upload is being reused", async () => {
    stubUploadXHR({ hold: true });
    const user = await openPanel(
      restoreUploadRoutes({
        start: () => ({
          body: {
            archive_id: "archive-1",
            object_key: "k",
            max_size_bytes: 9999,
            part_size_bytes: 64,
            uploaded_parts: [1],
            status: "uploading",
            sha256: "f".repeat(64),
            reused: false,
          },
        }),
      }),
    );
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    expect(await screen.findByText(/Resumed an earlier upload of this file/)).toBeInTheDocument();
  });

  it("skips the upload for an archive that is already in storage", async () => {
    stubUploadXHR();
    const user = await openPanel(
      restoreUploadRoutes({
        start: () => ({
          body: {
            archive_id: "archive-1",
            object_key: "k",
            max_size_bytes: 9999,
            part_size_bytes: 64,
            uploaded_parts: [],
            status: "uploaded",
            sha256: "f".repeat(64),
            reused: true,
          },
        }),
      }),
    );
    await user.upload(input(), wikihubBackupZip("backup.zip"));

    await uploadAndScan(user);

    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 5000 });
    expect(await screen.findByText(/already in object storage/i)).toBeInTheDocument();
  });
});

describe("WikiHub restore left unfinished", () => {
  const unfinished: Route = {
    method: "GET",
    match: (p) => p === "/api/v1/backup/archives/uploads/active",
    handler: () => ({
      body: [
        {
          archive_id: "archive-1",
          filename: "big-backup.zip",
          size_bytes: 400,
          sha256: "a".repeat(64),
          status: "uploading",
          part_size_bytes: 64,
          uploaded_parts: [1, 2],
        },
      ],
    }),
  };

  it("opens the file picker from the resume button", async () => {
    const user = await openPanel([unfinished]);
    const resume = await card().findByRole("button", { name: /^select file to resume$/i });
    const click = vi.spyOn(input(), "click");

    await user.click(resume);

    expect(click).toHaveBeenCalled();
  });

  it("discards an unfinished upload, and the same for a file that is not the one being resumed", async () => {
    let deletes = 0;
    stubUploadXHR();
    const user = await openPanel([
      unfinished,
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deletes += 1;
          return { body: {} };
        },
      },
      ...restoreUploadRoutes(),
    ]);
    await card().findByRole("button", { name: /^select file to resume$/i });

    await user.upload(input(), wikihubBackupZip("other.zip"));
    const prompt = await screen.findByRole("heading", { name: /that is a different file/i });
    expect(prompt).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^discard and upload this$/i }));

    await waitFor(() => expect(deletes).toBe(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unfinished upload discarded."));
  });

  it("goes back to asking for the right file", async () => {
    const user = await openPanel([unfinished]);
    await card().findByRole("button", { name: /^select file to resume$/i });
    const click = vi.spyOn(input(), "click");

    await user.upload(input(), wikihubBackupZip("other.zip"));
    await screen.findByRole("heading", { name: /that is a different file/i });
    await user.click(screen.getByRole("button", { name: /^choose the original$/i }));

    expect(click).toHaveBeenCalled();
  });
});
