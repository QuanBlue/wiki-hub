import { act, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";

function wrapper({ children }: { children: React.ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>;
}

function Show() {
  const s = useSidebar();
  return <span data-testid="s">{JSON.stringify({ c: s.collapsed, w: s.sidebarWidth })}</span>;
}

const root = document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  delete root.dataset.whSidebarCollapsed;
  delete root.dataset.whSidebarHydrated;
  root.style.removeProperty("--wh-preloaded-sidebar-width");
  vi.restoreAllMocks();
});

describe("SidebarProvider", () => {
  it("renders the server-provided preference during SSR", () => {
    const html = renderToString(
      <SidebarProvider initialCollapsed initialSidebarWidth={300}>
        <Show />
      </SidebarProvider>,
    );
    expect(html).toContain("&quot;c&quot;:true");
    expect(html).toContain("&quot;w&quot;:300");
  });

  it("marks itself hydrated and starts at the default width", () => {
    renderHook(() => useSidebar(), { wrapper });
    expect(root.dataset.whSidebarHydrated).toBe("true");
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.sidebarWidth).toBe(256);
    expect(result.current.collapsed).toBe(false);
  });

  it("reads the preference from storage, then the page's dataset", () => {
    window.localStorage.setItem("wikihub:sidebar-collapsed", "true");
    const stored = renderHook(() => useSidebar(), { wrapper });
    expect(stored.result.current.collapsed).toBe(true);
    stored.unmount();

    window.localStorage.clear();
    root.dataset.whSidebarCollapsed = "true";
    const fromDataset = renderHook(() => useSidebar(), { wrapper });
    expect(fromDataset.result.current.collapsed).toBe(true);
  });

  it("falls back to the dataset and the default width when storage throws", () => {
    root.dataset.whSidebarCollapsed = "true";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.sidebarWidth).toBe(256);

    // Writing still updates the page even though nothing can be persisted.
    act(() => result.current.setSidebarWidth(300));
    expect(root.style.getPropertyValue("--wh-preloaded-sidebar-width")).toBe("300px");
    act(() => result.current.setCollapsed(false));
    expect(root.dataset.whSidebarCollapsed).toBe("false");
  });

  it("clamps a stored width and ignores a corrupt one", () => {
    window.localStorage.setItem("wikihub:sidebar-width", "9999");
    const wide = renderHook(() => useSidebar(), { wrapper });
    expect(wide.result.current.sidebarWidth).toBe(520);
    wide.unmount();

    window.localStorage.setItem("wikihub:sidebar-width", "not-a-number");
    root.style.setProperty("--wh-preloaded-sidebar-width", "-40px");
    const preloaded = renderHook(() => useSidebar(), { wrapper });
    expect(preloaded.result.current.sidebarWidth).toBe(0);
    preloaded.unmount();

    window.localStorage.clear();
    root.style.setProperty("--wh-preloaded-sidebar-width", "900px");
    const clamped = renderHook(() => useSidebar(), { wrapper });
    expect(clamped.result.current.sidebarWidth).toBe(520);
  });

  it("persists collapse and width, and mirrors them to cookies", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });

    act(() => result.current.setSidebarWidth(-5));
    expect(result.current.sidebarWidth).toBe(0);
    act(() => result.current.setSidebarWidth(320));
    expect(result.current.sidebarWidth).toBe(320);
    expect(window.localStorage.getItem("wikihub:sidebar-width")).toBe("320");
    expect(document.cookie).toContain("wikihub_sidebar_width=320");

    act(() => result.current.setCollapsed(true));
    expect(result.current.collapsed).toBe(true);
    expect(document.cookie).toContain("wikihub_sidebar_collapsed=true");
    expect(root.dataset.whSidebarCollapsed).toBe("true");
  });

  it("restores a usable width when expanding from a collapsed rail", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.setSidebarWidth(40));
    act(() => result.current.setCollapsed(true));

    act(() => result.current.setCollapsed(false));
    expect(result.current.sidebarWidth).toBe(256);
    expect(result.current.collapsed).toBe(false);

    act(() => result.current.setSidebarWidth(40));
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.sidebarWidth).toBe(256);

    // A comfortable width is left alone.
    act(() => result.current.setSidebarWidth(400));
    act(() => result.current.setCollapsed(true));
    act(() => result.current.setCollapsed(false));
    expect(result.current.sidebarWidth).toBe(400);
  });

  it("follows changes made in another tab", () => {
    render(
      <SidebarProvider>
        <Show />
      </SidebarProvider>,
    );
    act(() => {
      window.localStorage.setItem("wikihub:sidebar-collapsed", "true");
      window.localStorage.setItem("wikihub:sidebar-width", "280");
      window.dispatchEvent(new Event("storage"));
    });
    expect(screen.getByTestId("s")).toHaveTextContent('{"c":true,"w":280}');
  });

  it("tracks the mobile drawer without persisting it", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.setMobileOpen(true));
    expect(result.current.mobileOpen).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it("refuses to be used outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSidebar())).toThrow(/inside <SidebarProvider>/);
  });
});
