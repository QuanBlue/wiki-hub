import { webcrypto } from "node:crypto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import {
  CONFLUENCE_ARCHIVE,
  RESTORE_ARCHIVE,
  baseRoutes,
  confluenceExportZip,
  confluenceUploadRoutes,
  mockFetch,
  restoreUploadRoutes,
  stubUploadXHR,
  wikihubBackupZip,
  type Route,
} from "./backup-panel-harness";

const push = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
  vi.stubGlobal("crypto", {
    subtle: { digest: (algorithm: string, data: BufferSource) => webcrypto.subtle.digest(algorithm, data) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

const card = () => within(screen.getByTestId("wikihub-restore-card"));
const restoreInput = () => document.getElementById("backup-file") as HTMLInputElement;

async function openPanel(routes: Route[] = []) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup({ applyAccept: false });
  render(<BackupPanel />);
  return user;
}

describe("export space picker", () => {
  async function openPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    await user.click(screen.getByRole("radio", { name: /select spaces/i }));
    await user.click(screen.getByRole("button", { name: /choose spaces/i }));
    await screen.findByText("Engineering");
  }

  it("ticks and unticks spaces, narrows the list, and says when nothing matches", async () => {
    const user = await openPanel();
    await openPicker(user);

    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.type(screen.getByRole("searchbox"), "sales");
    expect(screen.queryByText("Engineering")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    expect(screen.getByRole("checkbox", { name: /Sales/ })).toBeChecked();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "nothing like this");
    expect(screen.getByText(/No spaces match/)).toBeInTheDocument();
  });

  it("clears the choice", async () => {
    const user = await openPanel();
    await openPicker(user);
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("checkbox", { name: /Engineering/ })).toBeChecked();

    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(screen.getByRole("checkbox", { name: /Engineering/ })).not.toBeChecked();
  });
});

describe("restore space picker", () => {
  async function scanned(spaces = RESTORE_ARCHIVE.spaces) {
    stubUploadXHR();
    const user = await openPanel(
      restoreUploadRoutes({ scan: () => ({ body: { ...RESTORE_ARCHIVE, spaces } }) }),
    );
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(restoreInput(), wikihubBackupZip("backup.zip"));
    await user.click(card().getByRole("button", { name: /^upload and scan$/i }));
    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 5000 });
    return user;
  }

  it("ticks and unticks spaces, and says when the filter finds none", async () => {
    const user = await scanned();

    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.type(screen.getByRole("searchbox"), "zzzz");

    expect(screen.getByText('No spaces match "zzzz".')).toBeInTheDocument();
  });

  it("says when the archive has no spaces at all", async () => {
    await scanned([]);

    expect(await screen.findByText("This archive has no spaces.")).toBeInTheDocument();
  });
});

describe("Confluence space picker", () => {
  async function scanned() {
    stubUploadXHR();
    const user = await openPanel(confluenceUploadRoutes());
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(document.getElementById("confluence-backup-file") as HTMLInputElement, confluenceExportZip("conf.zip"));
    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);
    await screen.findByText("Engineering");
    return user;
  }

  it("ticks, unticks, selects what is visible and clears the choice", async () => {
    const user = await scanned();

    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.type(screen.getByRole("searchbox"), "ops");
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    expect(screen.getByRole("checkbox", { name: /Operations/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(screen.getByRole("checkbox", { name: /Operations/ })).not.toBeChecked();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText(/No spaces match/)).toBeInTheDocument();
  });

  it("lists the first eight spaces that will be replaced, and counts the rest", async () => {
    stubUploadXHR();
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `K${i}`,
      name: `Space ${i}`,
      page_count: 1,
      attachment_count: 0,
      conflict: true,
    }));
    const user = await openPanel(
      confluenceUploadRoutes({ scan: () => ({ body: { ...CONFLUENCE_ARCHIVE, spaces: many } }) }),
    );
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(document.getElementById("confluence-backup-file") as HTMLInputElement, confluenceExportZip("conf.zip"));
    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);
    await screen.findByText("Space 0");

    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: /^start import$/i }));

    expect(await screen.findByText(/and 2 more/)).toBeInTheDocument();
  });
});

describe("leaving the page", () => {
  const running = {
    id: "job-1",
    kind: "full_export",
    status: "running",
    phase: "exporting",
    counters: {},
    cancel_requested: false,
    output_filename: null,
    download_url: null,
    error: null,
    space_keys: [],
    percent: 20,
    eta_seconds: 60,
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const exportRoutes = (kind = "full_export"): Route[] => [
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/jobs",
      handler: () => ({ body: [{ ...running, kind }] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/jobs/job-1",
      handler: () => ({ body: { ...running, kind } }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/jobs/job-1/logs",
      handler: () => ({ body: { items: [] } }),
    },
  ];

  function clickLink() {
    const link = document.createElement("a");
    link.href = "/somewhere-else";
    document.body.appendChild(link);
    fireEvent.click(link, { button: 0 });
    link.remove();
  }

  it("warns that an export keeps running, and lets the person stay or leave", async () => {
    const user = await openPanel(exportRoutes());
    await screen.findByRole("button", { name: "Cancel export" });

    clickLink();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Export is still running")).toBeInTheDocument();
    expect(within(dialog).getByText(/or download the file/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();

    clickLink();
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave, keep running" }));
    expect(push).toHaveBeenCalledWith("/somewhere-else");
  });

  it("offers to stop the export instead of leaving", async () => {
    const user = await openPanel(exportRoutes());
    await screen.findByRole("button", { name: "Cancel export" });

    clickLink();
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel export" }));

    expect(await screen.findByText(/cancel this export|stop this export|cancel export\?/i)).toBeInTheDocument();
  });

  it("words the warning for a restore", async () => {
    await openPanel(exportRoutes("full_import"));
    await screen.findByRole("button", { name: /cancel restore/i });

    clickLink();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Restore is still running")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel restore" })).toBeInTheDocument();
  });
});
