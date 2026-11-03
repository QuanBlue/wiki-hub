import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuditLogDetailsDialog,
  AuditLogsExportButtons,
  AuditLogsFilterBar,
} from "@/components/admin/audit-logs-toolbar";
import { LocaleProvider } from "@/lib/i18n/context";
import type { AuditLogEntry } from "@/types/api";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "offset=50" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/admin/audit-logs",
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const options = {
  actorOptions: [{ value: "alice", label: "alice" }],
  entityTypeOptions: [{ value: "page", label: "Page" }],
  actionOptions: [{ value: "page_updated", label: "Page updated" }],
};

function filters(overrides: Partial<React.ComponentProps<typeof AuditLogsFilterBar>> = {}) {
  return (
    <LocaleProvider initialLocale="en">
      <AuditLogsFilterBar
        searchValue=""
        actorValue=""
        entityTypeValue=""
        actionValue=""
        sinceValue=""
        untilValue=""
        {...options}
        {...overrides}
      />
    </LocaleProvider>
  );
}

describe("AuditLogsFilterBar", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    nav.query = "offset=50";
  });

  it("submits search, chooses filters and resets pagination", async () => {
    const user = userEvent.setup();
    render(filters());
    await user.type(screen.getByRole("textbox", { name: /Search actor or target/i }), "  runbook  ");
    await user.click(screen.getByRole("button", { name: /^Search$/i }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?q=runbook");

    await user.click(screen.getByRole("button", { name: /^Actor/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "alice" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?actor=alice");

    fireEvent.change(screen.getByLabelText(/From date/i), { target: { value: "2026-11-01" } });
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?since=2026-11-01");
  });

  it("clears the search and all active filters", async () => {
    const user = userEvent.setup();
    nav.query = "q=alice&actor=alice&offset=50";
    render(filters({ searchValue: "alice", actorValue: "alice" }));
    await user.click(screen.getByRole("button", { name: /Clear search/i }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?actor=alice");
    await user.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs");
  });

  it("debounces a changed term and accepts a new search value from navigation", async () => {
    const view = render(filters());
    fireEvent.change(screen.getByRole("textbox", { name: /Search actor or target/i }), { target: { value: "  draft  " } });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?q=draft"));
    view.rerender(filters({ searchValue: "other" }));
    expect(screen.getByRole("textbox", { name: /Search actor or target/i })).toHaveValue("other");
  });

  it("selects target and action filters, including unknown current values", async () => {
    const user = userEvent.setup();
    render(filters({ entityTypeValue: "unknown", actionValue: "unknown" }));
    expect(screen.getByRole("button", { name: "Target type" })).toHaveTextContent("unknown");
    expect(screen.getByRole("button", { name: "Action" })).toHaveTextContent("unknown");
    await user.click(screen.getByRole("button", { name: "Target type" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Page" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?entity_type=page");
    await user.click(screen.getByRole("button", { name: "Action" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Page updated" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/audit-logs?action=page_updated");
  });
});

describe("audit log actions", () => {
  it("exports both formats with current filters", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <LocaleProvider initialLocale="en">
        <AuditLogsExportButtons q="runbook" actorUsername="alice" since="2026-11-01" />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    await user.click(screen.getByRole("button", { name: /Export JSON/i }));
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("shows actor, impersonator, changes and raw details", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "a1",
      created_at: "2026-11-02T01:00:00Z",
      actor_id: "u1",
      actor_username: "alice",
      impersonator_username: "root",
      action: "page_updated",
      entity_type: "page",
      entity_id: "p1",
      entity_label: "Runbook",
      ip_address: "10.0.0.1",
      details: { changes: { title: { from: "Old", to: "New" } }, reason: "review" },
    } as AuditLogEntry;
    render(
      <LocaleProvider initialLocale="en">
        <AuditLogDetailsDialog entry={entry} actionLabel="Page updated" entityTypeLabel="Page" />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Inspect: Page updated/i }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Runbook");
    expect(screen.getByRole("dialog")).toHaveTextContent("10.0.0.1");
    expect(screen.getByRole("dialog")).toHaveTextContent("Old");
    await waitFor(() => expect(screen.getAllByText(/Raw JSON/i).length).toBeGreaterThan(0));
  });

  it("renders structured change values and a system event without optional metadata", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "a2",
      created_at: "2026-11-02T01:00:00Z",
      actor_id: null,
      actor_username: "system",
      impersonator_username: null,
      ip_address: null,
      action: "settings_updated",
      entity_type: "settings",
      entity_id: "Settings",
      entity_label: "Settings",
      details: {
        changes: {
          enabled: { from: null, to: true },
          members: { from: [], to: ["alice", "bob"] },
          config: { from: {}, to: { mode: "strict" } },
          objectValue: { from: { mode: "old" }, to: "plain" },
          emptyObject: { from: {}, to: null },
        },
      },
    } as AuditLogEntry;
    render(
      <LocaleProvider initialLocale="en">
        <AuditLogDetailsDialog entry={entry} actionLabel="Settings updated" entityTypeLabel="Settings" />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Inspect: Settings updated/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("system");
    expect(dialog).toHaveTextContent("true");
    expect(dialog).toHaveTextContent("alice, bob");
    expect(dialog).toHaveTextContent("config.mode");
    expect(dialog).toHaveTextContent("mode: old");
  });

  it("shows a plain event with no diff or raw payload", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "a3",
      created_at: "2026-11-02T01:00:00Z",
      actor_id: null,
      actor_username: "system",
      impersonator_username: null,
      ip_address: null,
      action: "maintenance",
      entity_type: "system",
      entity_id: null,
      entity_label: "System",
      details: null,
    } as unknown as AuditLogEntry;
    render(
      <LocaleProvider initialLocale="en">
        <AuditLogDetailsDialog entry={entry} actionLabel="Maintenance" entityTypeLabel="System" />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Inspect: Maintenance/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Maintenance");
    expect(screen.queryByText(/Structured payload/i)).not.toBeInTheDocument();
  });
});
