import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HelpRoute from "@/app/help/page";
import HelpTopicRoute, { generateMetadata as helpMetadata } from "@/app/help/[topic]/page";
import PrintPage, { generateMetadata as printMetadata } from "@/app/print/page";
import SpaceRouteLayout, { generateMetadata as spaceLayoutMetadata } from "@/app/spaces/[key]/layout";
import WikiPageView from "@/app/spaces/[key]/pages/[slug]/page";
import { ApiError, api } from "@/lib/api-client";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  getSpace: vi.fn(),
  listSpaceMembers: vi.fn(),
  getPage: vi.fn(),
  listPages: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/spaces", () => ({ getSpace: m.getSpace, listSpaceMembers: m.listSpaceMembers }));
vi.mock("@/lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pages")>()),
  getPage: m.getPage,
  listPages: m.listPages,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn() },
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children, hideSidebar }: { children: React.ReactNode; hideSidebar?: boolean }) => (
    <div data-testid="shell" data-hide={String(!!hideSidebar)}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/help/help-page", () => ({
  HelpPage: () => <div>help-index</div>,
  HelpDetailPage: ({ topic }: { topic: string }) => <div>help-topic {topic}</div>,
}));
vi.mock("@/components/print/export-error", () => ({
  ExportError: ({ reason, message }: { reason: string; message?: string }) => (
    <div>
      export-error {reason} {message}
    </div>
  ),
}));
vi.mock("@/components/print/export-shell", () => ({
  ExportShell: ({ bundle }: { bundle: { page: { title: string } } }) => <div>export-shell {bundle.page.title}</div>,
}));
vi.mock("@/components/pages/record-visit", () => ({
  RecordVisit: ({ slug }: { slug: string }) => <i data-testid="visit">{slug}</i>,
}));
vi.mock("@/components/pages/space-workspace", () => ({
  SpaceWorkspace: (props: Record<string, unknown>) => (
    <div
      data-testid="workspace"
      data-pages={(props.pages as unknown[]).length}
      data-members={(props.members as unknown[]).length}
      data-edit={String(props.canEdit)}
      data-export={String(props.canExport)}
      data-restrictions={String(props.canManageRestrictions)}
      data-avatar={String((props.currentUser as { avatar_url: unknown }).avatar_url)}
    />
  ),
}));

const mockedGet = vi.mocked(api.get);

function me(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    username: "ann",
    full_name: "Ann",
    avatar_url: "/a.png",
    is_superuser: false,
    ...overrides,
  } as unknown as Me;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue(me());
});

describe("help routes", () => {
  it("require sign-in", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(HelpRoute()).rejects.toThrow("redirect:/login");
    await expect(HelpTopicRoute({ params: Promise.resolve({ topic: "writing" }) })).rejects.toThrow(
      "redirect:/login",
    );
  });

  it("render the index and a known topic", async () => {
    render(await HelpRoute());
    expect(screen.getByText("help-index")).toBeInTheDocument();
    document.body.innerHTML = "";
    render(await HelpTopicRoute({ params: Promise.resolve({ topic: "attachments" }) }));
    expect(screen.getByText("help-topic Attachments & Media")).toBeInTheDocument();
  });

  it("send an unknown topic to not-found", async () => {
    await expect(HelpTopicRoute({ params: Promise.resolve({ topic: "nope" }) })).rejects.toThrow("not-found");
  });

  it("title the page after the topic", async () => {
    expect(await helpMetadata({ params: Promise.resolve({ topic: "writing" }) })).toEqual({
      title: "Writing help",
    });
    expect(await helpMetadata({ params: Promise.resolve({ topic: "nope" }) })).toEqual({ title: "Help" });
  });
});

describe("print page", () => {
  const params = (token?: string | string[]) => ({ searchParams: Promise.resolve({ token }) });

  it("explains a missing token", async () => {
    render(await PrintPage(params()));
    expect(screen.getByText(/export-error missing-token/)).toBeInTheDocument();
    expect(await printMetadata(params())).toEqual({});
  });

  it("renders the exported bundle, using the first of repeated tokens", async () => {
    mockedGet.mockResolvedValue({ page: { title: "Runbook" } });
    render(await PrintPage(params(["tok", "other"])));
    expect(screen.getByText("export-shell Runbook")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/export-render/bundle", { cache: "no-store", token: "tok" });
    expect(await printMetadata(params("tok"))).toEqual({ title: "Runbook" });
  });

  it("reports why the bundle could not load", async () => {
    mockedGet.mockRejectedValueOnce(new ApiError(410, "gone", "Token expired"));
    render(await PrintPage(params("tok")));
    expect(screen.getByText(/export-error fetch-failed Token expired/)).toBeInTheDocument();

    mockedGet.mockRejectedValueOnce(new Error("net"));
    document.body.innerHTML = "";
    render(await PrintPage(params("tok")));
    expect(screen.getByText(/Could not load the page\./)).toBeInTheDocument();
  });

  it("keeps the default title when metadata cannot be fetched", async () => {
    mockedGet.mockRejectedValue(new Error("down"));
    expect(await printMetadata(params("tok"))).toEqual({});
  });
});

describe("space route layout", () => {
  it("titles the tab after the space, falling back to the key", async () => {
    m.getSpace.mockResolvedValue({ name: "Engineering" });
    const named = await spaceLayoutMetadata({ params: Promise.resolve({ key: "ENG" }) });
    expect(JSON.stringify(named.title)).toContain("Engineering");
    m.getSpace.mockRejectedValue(new Error("x"));
    expect(await spaceLayoutMetadata({ params: Promise.resolve({ key: "eng" }) })).toEqual({ title: "ENG" });
  });

  it("wraps children without the app sidebar, for signed-in users only", async () => {
    render(await SpaceRouteLayout({ children: <p>inner</p> }));
    expect(screen.getByTestId("shell")).toHaveAttribute("data-hide", "true");
    m.getCurrentUser.mockResolvedValue(null);
    await expect(SpaceRouteLayout({ children: <p>inner</p> })).rejects.toThrow("redirect:/login");
  });
});

describe("WikiPageView", () => {
  const space = { key: "ENG", name: "Engineering", my_permissions: ["restrictions"] };
  const page = { id: "p1", slug: "intro", title: "Intro", can_edit: true, can_export: true };

  async function renderFor(slug = "intro") {
    render(await WikiPageView({ params: Promise.resolve({ key: "ENG", slug }) }));
  }

  beforeEach(() => {
    m.getSpace.mockResolvedValue(space);
    m.listPages.mockResolvedValue([page]);
    m.listSpaceMembers.mockResolvedValue([{}, {}]);
    m.getPage.mockResolvedValue(page);
  });

  it("requires sign-in", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(renderFor()).rejects.toThrow("redirect:/login");
  });

  it("shows the page with the viewer's powers", async () => {
    await renderFor();
    expect(screen.getByTestId("visit")).toHaveTextContent("intro");
    const ws = screen.getByTestId("workspace");
    expect(ws).toHaveAttribute("data-edit", "true");
    expect(ws).toHaveAttribute("data-export", "true");
    expect(ws).toHaveAttribute("data-restrictions", "true");
    expect(ws).toHaveAttribute("data-members", "2");
    expect(ws).toHaveAttribute("data-avatar", "/a.png");
  });

  it("denies powers the page and space do not grant, and handles a missing avatar", async () => {
    m.getSpace.mockResolvedValue({ ...space, my_permissions: undefined });
    m.getPage.mockResolvedValue({ ...page, can_edit: false, can_export: undefined });
    m.getCurrentUser.mockResolvedValue(me({ avatar_url: undefined } as Partial<Me>));
    await renderFor();
    const ws = screen.getByTestId("workspace");
    expect(ws).toHaveAttribute("data-edit", "false");
    expect(ws).toHaveAttribute("data-export", "false");
    expect(ws).toHaveAttribute("data-restrictions", "false");
    expect(ws).toHaveAttribute("data-avatar", "null");
  });

  it("lets a superuser manage restrictions", async () => {
    m.getSpace.mockResolvedValue({ ...space, my_permissions: [] });
    m.getCurrentUser.mockResolvedValue(me({ is_superuser: true }));
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-restrictions", "true");
  });

  it("adds a just-created page the list has not caught up with", async () => {
    m.listPages.mockResolvedValue([]);
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-pages", "1");
  });

  it("treats a missing or forbidden space like a missing page", async () => {
    m.getSpace.mockRejectedValueOnce(new ApiError(403, "no", "forbidden"));
    await expect(renderFor()).rejects.toThrow("not-found");
    m.getSpace.mockRejectedValueOnce(new ApiError(500, "x", "kaboom"));
    await expect(renderFor()).rejects.toThrow("kaboom");
  });

  it("works without the membership endpoint, but not when it fails otherwise", async () => {
    m.listSpaceMembers.mockRejectedValueOnce(new ApiError(404, "nf", "old api"));
    await renderFor();
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-members", "0");

    m.listSpaceMembers.mockRejectedValueOnce(new ApiError(500, "x", "members down"));
    await expect(renderFor()).rejects.toThrow("members down");
    m.listSpaceMembers.mockRejectedValueOnce(new Error("plain"));
    await expect(renderFor()).rejects.toThrow("plain");
  });

  it("falls back to the navigation list when the page endpoint 404s", async () => {
    m.getPage.mockRejectedValueOnce(new ApiError(404, "nf", "lag"));
    await renderFor("intro");
    expect(screen.getByTestId("workspace")).toBeInTheDocument();
  });

  it("is not-found when the page is forbidden, or unknown everywhere", async () => {
    m.getPage.mockRejectedValueOnce(new ApiError(403, "no", "forbidden"));
    await expect(renderFor()).rejects.toThrow("not-found");
    m.getPage.mockRejectedValueOnce(new ApiError(404, "nf", "gone"));
    await expect(renderFor("ghost")).rejects.toThrow("not-found");
  });

  it("rethrows unexpected page failures", async () => {
    m.getPage.mockRejectedValueOnce(new ApiError(500, "x", "page boom"));
    await expect(renderFor()).rejects.toThrow("page boom");
    m.getPage.mockRejectedValueOnce(new Error("plain page"));
    await expect(renderFor()).rejects.toThrow("plain page");
  });
});
