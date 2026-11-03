import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminAuditLogsPage from "@/app/admin/audit-logs/page";
import { buildAuditExportUrl } from "@/components/admin/audit-logs-toolbar";
import { extractChangeDiffs } from "@/lib/audit";
import type { AuditLogEntry, Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listAuditLogs: vi.fn(),
  listAuditActions: vi.fn(),
  listAuditActors: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/admin", () => ({
  listAuditLogs: m.listAuditLogs,
  listAuditActions: m.listAuditActions,
  listAuditActors: m.listAuditActors,
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? `${key}(${Object.entries(params)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")})`
        : key,
    locale: "en",
  }),
}));
vi.mock("@/components/admin/list-controls", () => ({
  PaginationControls: ({ total, limit, offset }: { total: number; limit: number; offset: number }) => (
    <div data-testid="pager">{`${total}/${limit}/${offset}`}</div>
  ),
}));
vi.mock("@/components/admin/refresh-button", () => ({
  RefreshButton: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock("@/components/admin/audit-logs-toolbar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/admin/audit-logs-toolbar")>();
  return {
    ...actual,
    AuditLogsFilterBar: ({ searchValue, actorValue }: { searchValue: string; actorValue: string }) => (
      <div data-testid="audit-filters">{`${searchValue}|${actorValue}`}</div>
    ),
    AuditLogsExportButtons: ({ disabled }: { disabled?: boolean }) => (
      <div data-testid="audit-export" data-disabled={String(!!disabled)} />
    ),
    AuditLogDetailsDialog: ({ entry }: { entry: AuditLogEntry }) => (
      <button data-testid={`details-${entry.id}`}>inspect</button>
    ),
  };
});

function makeAdmin(overrides: Partial<Me> = {}): Me {
  return {
    id: "admin-1",
    username: "root",
    is_superuser: true,
    is_protected: true,
    global_permissions: ["system_admin"],
    ...overrides,
  } as unknown as Me;
}

describe("AdminAuditLogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listAuditActions.mockResolvedValue(["user_updated", "space_updated", "group_updated"]);
    m.listAuditActors.mockResolvedValue(["root", "alice"]);
  });

  it("denies non-system-admin visitors", async () => {
    m.getCurrentUser.mockResolvedValue(
      makeAdmin({ is_superuser: false, global_permissions: ["manage_users"] }),
    );
    render(await AdminAuditLogsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.listAuditLogs).not.toHaveBeenCalled();
  });

  it("renders audit entries including impersonation attribution and diff summaries", async () => {
    m.getCurrentUser.mockResolvedValue(makeAdmin());
    const entries: AuditLogEntry[] = [
      {
        id: "log-1",
        created_at: "2026-11-02T01:00:00Z",
        actor_id: "u-2",
        actor_username: "alice",
        impersonator_username: "root",
        action: "space_updated",
        entity_type: "space",
        entity_id: "s-1",
        entity_label: "Engineering",
        details: {
          space_key: "ENG",
          changes: {
            visibility: { from: "open", to: "restricted" },
          },
        },
        ip_address: "10.0.0.5",
      },
    ];
    m.listAuditLogs.mockResolvedValue({
      items: entries,
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(
      await AdminAuditLogsPage({
        searchParams: Promise.resolve({
          q: "ENG",
          actor: "root",
          entity_type: "space",
          action: "space_updated",
          since: "2026-11-01",
          until: "2026-11-02",
        }),
      }),
    );

    expect(m.listAuditLogs).toHaveBeenCalledWith({
      q: "ENG",
      actor_username: "root",
      entity_type: "space",
      action: "space_updated",
      since: "2026-11-01T00:00:00Z",
      until: "2026-11-02T23:59:59.999Z",
      limit: 50,
      offset: 0,
    });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("adminAuditLogs.impersonatedVia(admin=root)")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("visibility: open → restricted")).toBeInTheDocument();
    expect(screen.getByTestId("details-log-1")).toBeInTheDocument();
  });

  it("builds export URLs with active filter parameters", () => {
    const url = buildAuditExportUrl("csv", {
      q: "alice",
      actor_username: "root",
      entity_type: "user",
      action: "user_updated",
      since: "2026-11-01",
      until: "2026-11-02",
    });
    expect(url).toContain("/api/v1/audit-logs/export?");
    expect(url).toContain("format=csv");
    expect(url).toContain("q=alice");
    expect(url).toContain("actor_username=root");
    expect(url).toContain("entity_type=user");
    expect(url).toContain("action=user_updated");
    expect(url).toContain("since=2026-11-01T00%3A00%3A00Z");
    expect(url).toContain("until=2026-11-02T23%3A59%3A59.999Z");
  });

  it("flattens nested object changes into readable property diffs", () => {
    const raw = {
      announcement: {
        from: {
          level: "info",
          title: "Maintenance",
          enabled: true,
          updated_at: "2026-10-30T11:14:25Z",
        },
        to: {
          level: "warning",
          title: "Maintenance",
          enabled: false,
          updated_at: "2026-11-02T07:31:38Z",
        },
      },
      public_shares_enabled: {
        from: null,
        to: false,
      },
    };

    const diffs = extractChangeDiffs(raw);
    expect(diffs).toEqual([
      { field: "announcement.level", from: "info", to: "warning" },
      { field: "announcement.enabled", from: true, to: false },
      { field: "announcement.updated_at", from: "2026-10-30T11:14:25Z", to: "2026-11-02T07:31:38Z" },
      { field: "public_shares_enabled", from: null, to: false },
    ]);
  });

  it("keeps unchanged object snapshots and handles absent changes", () => {
    expect(extractChangeDiffs(null)).toEqual([]);
    expect(extractChangeDiffs({ settings: { from: { enabled: true }, to: { enabled: true } } })).toEqual([
      { field: "settings", from: { enabled: true }, to: { enabled: true } },
    ]);
  });

  it("shows the empty state and normalizes an unsupported page size", async () => {
    m.getCurrentUser.mockResolvedValue(makeAdmin());
    m.listAuditLogs.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    render(await AdminAuditLogsPage({ searchParams: Promise.resolve({ limit: "17" }) }));
    expect(m.listAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    expect(screen.getByText("adminAuditLogs.noLogsFound")).toBeInTheDocument();
    expect(screen.getByTestId("audit-export")).toHaveAttribute("data-disabled", "true");
  });

  it("summarizes account, permission, role, list and setting changes", async () => {
    m.getCurrentUser.mockResolvedValue(makeAdmin());
    const base = {
      id: "a-base",
      created_at: "2026-11-02T01:00:00Z",
      actor_id: null,
      actor_username: "system",
      impersonator_username: null,
      action: "user_deleted",
      entity_type: "user",
      entity_id: "u1",
      entity_label: null,
      ip_address: null,
      details: {},
    } as unknown as AuditLogEntry;
    const entries: AuditLogEntry[] = [
      { ...base, id: "empty" },
      { ...base, id: "anonymous", entity_id: null },
      {
        ...base,
        id: "account",
        actor_username: "alice",
        action: "user_created",
        entity_label: "bob",
        details: {
          space_key: "ENG",
          user: "bob",
          principal: "eng",
          principal_type: "group",
          permission: "edit",
          owner: "alice",
          role: { from: "reader", to: "editor" },
          added: ["view"],
          removed: ["delete"],
          is_superuser: false,
          overrides: { storage: ["read", "write"], empty: [], active: true, complex: { a: 1, b: 2 } },
        },
      },
      {
        ...base,
        id: "settings",
        action: "impersonation_started",
        entity_type: "site_settings",
        entity_label: "Settings",
        details: {
          changes: {
            theme: { from: { title: "Old" }, to: { name: "New" } },
            flags: { from: null, to: true },
            blank: { from: "", to: {} },
          },
        },
      },
    ];
    m.listAuditLogs.mockResolvedValue({ items: entries, total: 4, limit: 50, offset: 0 });
    render(await AdminAuditLogsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("key: ENG")).toBeInTheDocument();
    expect(screen.getAllByText(/^\+\d+$/).length).toBeGreaterThan(0);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByTestId("details-account")).toBeInTheDocument();
    expect(screen.getByTestId("details-settings")).toBeInTheDocument();
  });
});
