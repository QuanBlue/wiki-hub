import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupPanel } from "@/components/admin/backup-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

type RouteHandler = (init?: RequestInit) => { status?: number; body: unknown };

function mockFetch(routes: Array<{ method: string; match: (pathname: string) => boolean; handler: RouteHandler }>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.match(pathname));
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: `Unhandled ${method} ${pathname}` } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const { status = 200, body } = route.handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const SPACES = [
  { id: "s1", key: "ENG", name: "Engineering", status: "active" },
  { id: "s2", key: "SALES", name: "Sales", status: "active" },
];

/** The baseline set of routes every render of BackupPanel hits on mount. */
function baseRoutes(): Array<{ method: string; match: (pathname: string) => boolean; handler: RouteHandler }> {
  return [
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/jobs",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/uploads/active",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/settings",
      handler: () => ({ status: 500, body: { error: { code: "unavailable", message: "n/a" } } }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/spaces",
      handler: () => ({ body: SPACES }),
    },
    {
      method: "GET",
      match: (p) => p.startsWith("/api/v1/backup/jobs/"),
      handler: () => ({
        body: {
          id: "job-1",
          kind: "full_export",
          status: "queued",
          phase: "queued",
          output_filename: null,
          download_url: null,
          error: null,
          space_keys: [],
        },
      }),
    },
  ];
}

describe("BackupPanel native export scope", () => {
  it("exports every space by default", async () => {
    const jobsPosted: unknown[] = [];
    mockFetch([
      ...baseRoutes(),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_export",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /create full backup zip/i }),
    );

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({ kind: "full_export", space_keys: [] });
  });

  it("disables the export button until spaces are chosen, and lazily loads the space picker", async () => {
    mockFetch(baseRoutes());
    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("radio", { name: /select spaces/i }));

    expect(
      screen.getByRole("button", { name: /create full backup zip/i }),
    ).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("sends only the selected spaces once chosen", async () => {
    const jobsPosted: unknown[] = [];
    mockFetch([
      ...baseRoutes(),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_export",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("radio", { name: /select spaces/i }));
    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));
    await actor.click(await screen.findByRole("checkbox", { name: /Engineering/ }));
    await actor.click(screen.getByRole("button", { name: /^done$/i }));

    const exportButton = screen.getByRole("button", {
      name: /create full backup zip/i,
    });
    expect(exportButton).not.toBeDisabled();
    await actor.click(exportButton);

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({
      kind: "full_export",
      space_keys: ["ENG"],
    });
  });
});
