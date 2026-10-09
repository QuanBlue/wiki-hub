import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeColorProvider, useThemeSettings } from "@/components/theme-color-provider";

const favicon = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/lib/theme-presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme-presets")>()),
  renderFaviconPngDataUrl: favicon.render,
}));

function Probe() {
  const s = useThemeSettings();
  return (
    <div>
      <span data-testid="values">
        {[s.siteName, s.themeColor, s.defaultFont, s.logoIcon, s.customLogoUrl ?? "none"].join("|")}
      </span>
      <button onClick={() => s.setSiteName("  Acme Docs ")}>name</button>
      <button onClick={() => s.setSiteName("   ")}>blank-name</button>
      <button onClick={() => s.setThemeColor("rose")}>color</button>
      <button onClick={() => s.setThemeColor("blue")}>blue</button>
      <button onClick={() => s.setDefaultFont("lora")}>font</button>
      <button onClick={() => s.setLogoIcon("book")}>icon</button>
      <button onClick={() => s.setCustomLogoUrl("/logo.png")}>logo</button>
      <button onClick={() => s.setCustomLogoUrl(null)}>no-logo</button>
    </div>
  );
}

function renderProvider(props: Partial<React.ComponentProps<typeof ThemeColorProvider>> = {}) {
  return render(
    <ThemeColorProvider {...props}>
      <Probe />
    </ThemeColorProvider>,
  );
}

const values = () => screen.getByTestId("values").textContent;
const root = () => document.documentElement;

function mockMeta(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("style");
  root().classList.remove("dark");
  document.head.querySelectorAll("link").forEach((link) => link.remove());
  document.title = "";
  favicon.render.mockResolvedValue("data:image/png;base64,AAA");
  mockMeta(null, false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeColorProvider", () => {
  it("uses the server-provided values by default", () => {
    renderProvider();
    expect(values()).toBe("WikiHub|blue|inter|default|none");
  });

  it("prefers stored values over defaults, then the props sync over them", async () => {
    window.localStorage.setItem("wikihub:site-name", "Stored");
    window.localStorage.setItem("wikihub:theme-color", "rose");
    window.localStorage.setItem("wikihub:default-font", "serif");
    window.localStorage.setItem("wikihub:logo-icon", "book");
    window.localStorage.setItem("wikihub:custom-logo-url", "/stored.png");
    renderProvider({
      initialSiteName: "Server",
      initialThemeColor: "emerald",
      initialDefaultFont: "mono",
      initialLogoIcon: "layers",
      initialCustomLogoUrl: "/server.png",
    });
    // The effects re-apply the server's props on mount.
    await waitFor(() => expect(values()).toBe("Server|emerald|mono|layers|/server.png"));
  });

  it("keeps stored values when the server props are empty", () => {
    window.localStorage.setItem("wikihub:site-name", "Stored");
    window.localStorage.setItem("wikihub:theme-color", "rose");
    window.localStorage.setItem("wikihub:default-font", "serif");
    window.localStorage.setItem("wikihub:logo-icon", "book");
    window.localStorage.setItem("wikihub:custom-logo-url", "/stored.png");
    renderProvider({
      initialSiteName: "",
      initialThemeColor: "",
      initialDefaultFont: "",
      initialLogoIcon: "",
      initialCustomLogoUrl: "/stored.png",
    });
    expect(values()).toBe("Stored|rose|serif|book|/stored.png");
  });

  it("saves each setting to storage and a cookie", async () => {
    const actor = userEvent.setup();
    renderProvider();

    await actor.click(screen.getByText("name"));
    await actor.click(screen.getByText("color"));
    await actor.click(screen.getByText("font"));
    await actor.click(screen.getByText("icon"));
    await actor.click(screen.getByText("logo"));

    expect(values()).toBe("Acme Docs|rose|lora|book|/logo.png");
    expect(window.localStorage.getItem("wikihub:site-name")).toBe("Acme Docs");
    expect(window.localStorage.getItem("wikihub:theme-color")).toBe("rose");
    expect(window.localStorage.getItem("wikihub:default-font")).toBe("lora");
    expect(window.localStorage.getItem("wikihub:logo-icon")).toBe("book");
    expect(window.localStorage.getItem("wikihub:custom-logo-url")).toBe("/logo.png");
    expect(document.cookie).toContain("wikihub_site_name=Acme%20Docs");
    expect(document.cookie).toContain("wikihub_theme_color=rose");
    expect(document.cookie).toContain("wikihub_default_font=lora");
    expect(document.cookie).toContain("wikihub_logo_icon=book");

    await actor.click(screen.getByText("no-logo"));
    expect(window.localStorage.getItem("wikihub:custom-logo-url")).toBeNull();
    expect(values()).toMatch(/\|none$/);

    await actor.click(screen.getByText("blank-name"));
    expect(values()).toMatch(/^WikiHub\|/);
  });

  it("adopts the latest instance settings from the server", async () => {
    mockMeta({
      site_name: "Remote",
      theme_color: "indigo",
      default_font: "mono",
      logo_icon: "layers",
      custom_logo_url: "/remote.png",
      version: "1",
    });
    renderProvider();

    await waitFor(() => expect(values()).toBe("Remote|indigo|mono|layers|/remote.png"));
    expect(window.localStorage.getItem("wikihub:site-name")).toBe("Remote");
    expect(window.localStorage.getItem("wikihub:custom-logo-url")).toBe("/remote.png");
    expect(document.cookie).toContain("wikihub_logo_icon=layers");
  });

  it("clears a removed custom logo and skips absent settings", async () => {
    window.localStorage.setItem("wikihub:custom-logo-url", "/old.png");
    mockMeta({ custom_logo_url: null, version: "1" });
    renderProvider();

    await waitFor(() =>
      expect(window.localStorage.getItem("wikihub:custom-logo-url")).toBeNull(),
    );
    expect(values()).toBe("WikiHub|blue|inter|default|none");
  });

  it("ignores a meta response without a custom logo field", async () => {
    mockMeta({ version: "1" });
    renderProvider({ initialCustomLogoUrl: "/kept.png" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(values()).toMatch(/\/kept\.png$/);
  });

  it("survives a failed meta request and an unmount before it resolves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const first = renderProvider();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    first.unmount();

    let resolve: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((r) => (resolve = r))),
    );
    const second = renderProvider();
    second.unmount();
    await act(async () => {
      resolve({ ok: true, json: () => Promise.resolve({ site_name: "Late" }) });
    });
    expect(window.localStorage.getItem("wikihub:site-name")).toBeNull();
  });

  it("renames the browser tab title with the workspace", async () => {
    const actor = userEvent.setup();
    document.title = "WikiHub";
    renderProvider();
    await actor.click(screen.getByText("name"));
    expect(document.title).toBe("Acme Docs");

    document.title = "Page · Acme Docs";
    await actor.click(screen.getByText("blank-name"));
    expect(document.title).toBe("Page · WikiHub");

    document.title = "Unrelated";
    await actor.click(screen.getByText("name"));
    expect(document.title).toBe("Unrelated");
  });

  it("sets the page font variable", async () => {
    const actor = userEvent.setup();
    renderProvider();
    const initial = root().style.getPropertyValue("--wh-page-font");
    expect(initial).not.toBe("");
    await actor.click(screen.getByText("font"));
    expect(root().style.getPropertyValue("--wh-page-font")).not.toBe(initial);
  });

  it("applies a custom palette, adapts to dark mode and resets for the default", async () => {
    const actor = userEvent.setup();
    renderProvider();
    expect(root().style.getPropertyValue("--primary")).toBe("");

    await actor.click(screen.getByText("color"));
    const light = root().style.getPropertyValue("--primary");
    expect(light).not.toBe("");
    expect(root().style.getPropertyValue("--wh-brand-500")).not.toBe("");
    expect(root().style.getPropertyValue("--primary-subtle")).not.toContain("color-mix");

    await act(async () => {
      root().classList.add("dark");
    });
    await waitFor(() =>
      expect(root().style.getPropertyValue("--primary-subtle")).toContain("color-mix"),
    );
    expect(root().style.getPropertyValue("--primary")).not.toBe(light);

    await act(async () => {
      root().classList.remove("dark");
    });
    await waitFor(() => expect(root().style.getPropertyValue("--primary")).toBe(light));

    await actor.click(screen.getByText("blue"));
    expect(root().style.getPropertyValue("--primary")).toBe("");
    // With the default palette a class change must not set anything.
    await act(async () => {
      root().classList.add("dark");
    });
    await waitFor(() => expect(root().classList.contains("dark")).toBe(true));
    expect(root().style.getPropertyValue("--primary")).toBe("");
  });

  it("creates a favicon link and later updates it together with the shortcut icon", async () => {
    const actor = userEvent.setup();
    renderProvider();
    await waitFor(() =>
      expect(document.querySelector<HTMLLinkElement>("link#dynamic-favicon")).not.toBeNull(),
    );
    const link = document.querySelector<HTMLLinkElement>("link#dynamic-favicon")!;
    expect(link.type).toBe("image/png");
    expect(link.href).toContain("data:image/png");

    const shortcut = document.createElement("link");
    shortcut.rel = "shortcut icon";
    document.head.appendChild(shortcut);
    favicon.render.mockResolvedValue("data:image/png;base64,BBB");
    await actor.click(screen.getByText("icon"));
    await waitFor(() => expect(shortcut.href).toContain("BBB"));
    expect(shortcut.type).toBe("image/png");
    expect(document.querySelectorAll("link#dynamic-favicon")).toHaveLength(1);
  });

  it("reuses an existing icon link instead of adding one", async () => {
    const existing = document.createElement("link");
    existing.rel = "icon";
    document.head.appendChild(existing);
    renderProvider();
    await waitFor(() => expect(existing.href).toContain("data:image/png"));
    expect(document.querySelector("link#dynamic-favicon")).toBeNull();
  });

  it("drops a favicon render that finishes after unmounting", async () => {
    let resolve: (href: string) => void = () => {};
    favicon.render.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const view = renderProvider();
    view.unmount();
    await act(async () => resolve("data:image/png;base64,LATE"));
    expect(document.querySelector("link#dynamic-favicon")).toBeNull();
  });

  it("falls back to the default context outside a provider", () => {
    render(<Probe />);
    expect(values()).toBe("WikiHub|blue|inter|default|none");
    // The no-op setters do nothing and do not throw.
    screen.getByText("name").click();
    expect(values()).toBe("WikiHub|blue|inter|default|none");
    screen.getByText("color").click();
    screen.getByText("font").click();
    screen.getByText("icon").click();
    screen.getByText("logo").click();
  });
});
