import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ cookies: new Map<string, string>(), serverGet: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (m.cookies.has(name) ? { value: m.cookies.get(name) } : undefined),
  }),
}));
vi.mock("@/lib/server-api", () => ({ serverGet: m.serverGet }));
vi.mock("@/app/globals.css", () => ({}));
vi.mock("next/script", () => ({
  default: ({ id }: { id: string }) => <script data-script={id} />,
}));
vi.mock("@/components/providers", () => ({
  Providers: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => (
    <div data-testid="providers" data-props={JSON.stringify(props)}>
      {children}
    </div>
  ),
}));
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `font-${name}` });
  return {
    Inter: font("inter"),
    Roboto: font("roboto"),
    Open_Sans: font("open-sans"),
    Plus_Jakarta_Sans: font("plus-jakarta"),
    Outfit: font("outfit"),
    Montserrat: font("montserrat"),
    Source_Sans_3: font("source-sans"),
    Nunito: font("nunito"),
    Poppins: font("poppins"),
    Lora: font("lora"),
    Merriweather: font("merriweather"),
    Playfair_Display: font("playfair"),
    JetBrains_Mono: font("jetbrains"),
    Lato: font("lato"),
    Noto_Sans: font("noto-sans"),
    Work_Sans: font("work-sans"),
    DM_Sans: font("dm-sans"),
    IBM_Plex_Sans: font("ibm-plex"),
    Manrope: font("manrope"),
    Rubik: font("rubik"),
    Raleway: font("raleway"),
    Source_Serif_4: font("source-serif"),
    Noto_Serif: font("noto-serif"),
    PT_Serif: font("pt-serif"),
    Crimson_Pro: font("crimson"),
  };
});

import RootLayout, { generateMetadata, viewport } from "@/app/layout";

async function html(): Promise<string> {
  return renderToStaticMarkup(await RootLayout({ children: <p>page body</p> }));
}

function providerProps(markup: string): Record<string, unknown> {
  const raw = /data-props="([^"]*)"/.exec(markup)![1].replace(/&quot;/g, '"');
  return JSON.parse(raw);
}

beforeEach(() => {
  m.cookies.clear();
  m.serverGet.mockReset();
  m.serverGet.mockResolvedValue(null);
});

describe("generateMetadata", () => {
  it("names the site after the instance", async () => {
    m.serverGet.mockResolvedValue({ site_name: "Acme Docs" });
    const meta = await generateMetadata();
    expect(meta.title).toEqual({ default: "Acme Docs", template: "%s · Acme Docs" });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("falls back to the configured name when the backend has none or is unreachable", async () => {
    m.serverGet.mockResolvedValue({ site_name: "" });
    const empty = await generateMetadata();
    m.serverGet.mockRejectedValue(new Error("down"));
    const down = await generateMetadata();
    expect(down.title).toEqual(empty.title);
    expect((down.title as { default: string }).default).toBeTruthy();
  });

  it("exports a responsive viewport", () => {
    expect(viewport).toEqual({ width: "device-width", initialScale: 1 });
  });
});

describe("RootLayout", () => {
  it("renders with defaults when there are no cookies and no metadata", async () => {
    const markup = await html();
    expect(markup).toContain('lang="en"');
    expect(markup).toContain('data-wh-sidebar-collapsed="false"');
    expect(markup).toContain("--wh-preloaded-sidebar-width:256px");
    expect(markup).toContain("--wh-preloaded-space-sidebar-width:320px");
    expect(markup).toContain("font-inter");
    expect(markup).toContain("page body");
    expect(markup).toContain('data-script="preload-sidebar-preferences"');
    expect(markup).not.toContain("wh-preloaded-theme-vars");
    expect(providerProps(markup)).toMatchObject({
      initialThemeColor: "blue",
      initialDefaultFont: "inter",
      initialLogoIcon: "default",
      initialCustomLogoUrl: null,
      initialLocale: "en",
    });
  });

  it("restores the preferences stored in cookies", async () => {
    m.cookies.set("wikihub_sidebar_collapsed", "true");
    m.cookies.set("wikihub_sidebar_width", "9999");
    m.cookies.set("wikihub_space_sidebar_width", "10");
    m.cookies.set("wikihub_locale", "vi");
    m.cookies.set("wikihub_site_name", "Cookie Wiki");
    m.cookies.set("wikihub_theme_color", "rose");
    m.cookies.set("wikihub_default_font", "lora");
    m.cookies.set("wikihub_logo_icon", "book");
    const markup = await html();

    expect(markup).toContain('lang="vi"');
    expect(markup).toContain('data-wh-sidebar-collapsed="true"');
    expect(markup).toContain("--wh-preloaded-sidebar-width:520px");
    expect(markup).toContain("--wh-preloaded-space-sidebar-width:200px");
    expect(markup).toContain("wh-preloaded-theme-vars");
    expect(markup).toContain("color-mix");
    expect(providerProps(markup)).toMatchObject({
      initialSiteName: "Cookie Wiki",
      initialThemeColor: "rose",
      initialDefaultFont: "lora",
      initialLogoIcon: "book",
      initialLocale: "vi",
    });
  });

  it("ignores an unknown locale and non-numeric widths", async () => {
    m.cookies.set("wikihub_locale", "xx");
    m.cookies.set("wikihub_sidebar_width", "wide");
    const markup = await html();
    expect(markup).toContain('lang="en"');
    expect(markup).toContain("--wh-preloaded-sidebar-width:256px");
  });

  it("lets the instance settings override the cookies", async () => {
    m.cookies.set("wikihub_theme_color", "rose");
    m.serverGet.mockResolvedValue({
      site_name: "Server Wiki",
      theme_color: "emerald",
      default_font: "mono",
      logo_icon: "layers",
      custom_logo_url: "/logo.png",
    });
    const markup = await html();

    expect(providerProps(markup)).toMatchObject({
      initialSiteName: "Server Wiki",
      initialThemeColor: "emerald",
      initialDefaultFont: "mono",
      initialLogoIcon: "layers",
      initialCustomLogoUrl: "/logo.png",
    });
    expect(markup).toContain('type="image/png"');
    expect(markup).toContain('href="/logo.png"');
  });

  it("keeps cookie values for fields the server leaves empty", async () => {
    m.cookies.set("wikihub_site_name", "Cookie Wiki");
    m.serverGet.mockResolvedValue({
      site_name: "",
      theme_color: "",
      default_font: "",
      logo_icon: "",
    });
    const markup = await html();
    expect(providerProps(markup)).toMatchObject({
      initialSiteName: "Cookie Wiki",
      initialThemeColor: "blue",
      initialCustomLogoUrl: null,
    });
    expect(markup).toContain("image/svg+xml");
  });

  it("survives an unreachable backend", async () => {
    m.serverGet.mockRejectedValue(new Error("booting"));
    expect(await html()).toContain("page body");
  });
});
