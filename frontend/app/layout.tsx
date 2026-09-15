import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import {
  Inter,
  Roboto,
  Open_Sans,
  Plus_Jakarta_Sans,
  Outfit,
  Montserrat,
  Source_Sans_3,
  Nunito,
  Poppins,
  Lora,
  Merriweather,
  Playfair_Display,
  JetBrains_Mono,
} from "next/font/google";
import Script from "next/script";
import type { CSSProperties } from "react";

import { Providers } from "@/components/providers";
import { SITE_NAME } from "@/lib/env";
import { getFontFamilyCss } from "@/lib/font-presets";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/core";
import { serverGet } from "@/lib/server-api";
import {
  generateFaviconSvg,
  getPresetOrCustomPalette,
} from "@/lib/theme-presets";
import type { InstanceInfo } from "@/types/api";

import "./globals.css";

// Self-hosted at build time by next/font - no runtime request to a font CDN,
// which keeps WikiHub usable on an air-gapped network.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans-3",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-merriweather",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const fontClasses = [
  inter.variable,
  roboto.variable,
  openSans.variable,
  plusJakartaSans.variable,
  outfit.variable,
  montserrat.variable,
  sourceSans3.variable,
  nunito.variable,
  poppins.variable,
  lora.variable,
  merriweather.variable,
  playfairDisplay.variable,
  jetbrainsMono.variable,
].join(" ");

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: "Self-hosted internal documentation for teams.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const SIDEBAR_COLLAPSED_COOKIE = "wikihub_sidebar_collapsed";
const SIDEBAR_WIDTH_COOKIE = "wikihub_sidebar_width";
const SPACE_SIDEBAR_WIDTH_COOKIE = "wikihub_space_sidebar_width";
const THEME_COLOR_COOKIE = "wikihub_theme_color";
const DEFAULT_FONT_COOKIE = "wikihub_default_font";
const LOGO_ICON_COOKIE = "wikihub_logo_icon";
const SITE_NAME_COOKIE = "wikihub_site_name";
// LOCALE_COOKIE ("wikihub_locale") is defined next to the i18n constants.

function preferredWidth(
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(520, Math.max(minimum, parsed))
    : fallback;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const preferenceCookies = await cookies();
  const sidebarCollapsed =
    preferenceCookies.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "true";
  const appSidebarWidth = preferredWidth(
    preferenceCookies.get(SIDEBAR_WIDTH_COOKIE)?.value,
    256,
    0,
  );
  const spaceSidebarWidth = preferredWidth(
    preferenceCookies.get(SPACE_SIDEBAR_WIDTH_COOKIE)?.value,
    320,
    200,
  );

  const localeCookie = preferenceCookies.get(LOCALE_COOKIE)?.value;
  const initialLocale = isLocale(localeCookie) ? localeCookie : "en";

  let initialSiteName =
    preferenceCookies.get(SITE_NAME_COOKIE)?.value || SITE_NAME;
  let initialThemeColor =
    preferenceCookies.get(THEME_COLOR_COOKIE)?.value || "blue";
  let initialDefaultFont =
    preferenceCookies.get(DEFAULT_FONT_COOKIE)?.value || "inter";
  let initialLogoIcon =
    preferenceCookies.get(LOGO_ICON_COOKIE)?.value || "default";
  let initialCustomLogoUrl: string | null = null;

  try {
    const meta = await serverGet<InstanceInfo>("/api/v1/meta");
    if (meta) {
      if (meta.site_name) initialSiteName = meta.site_name;
      if (meta.theme_color) initialThemeColor = meta.theme_color;
      if (meta.default_font) initialDefaultFont = meta.default_font;
      if (meta.logo_icon) initialLogoIcon = meta.logo_icon;
      if (meta.custom_logo_url !== undefined) {
        initialCustomLogoUrl = meta.custom_logo_url;
      }
    }
  } catch {
    // If backend is booting or unreachable during initial SSR, fall back to cookies / defaults
  }

  const palette = getPresetOrCustomPalette(initialThemeColor);
  const primaryColor = palette[600] || "#216fc0";
  const initialFaviconSvg = generateFaviconSvg(initialLogoIcon, primaryColor);
  const initialFaviconHref =
    initialCustomLogoUrl ||
    `data:image/svg+xml,${encodeURIComponent(initialFaviconSvg)}`;

  const initialFontCss = getFontFamilyCss(initialDefaultFont);

  return (
    <html
      lang={initialLocale}
      suppressHydrationWarning
      data-wh-sidebar-collapsed={String(sidebarCollapsed)}
      data-wh-sidebar-hydrated="false"
      className={fontClasses}
      style={
        {
          "--wh-preloaded-sidebar-width": `${appSidebarWidth}px`,
          "--wh-preloaded-space-sidebar-width": `${spaceSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <head suppressHydrationWarning>
        <link
          id="dynamic-favicon"
          rel="icon"
          type={initialCustomLogoUrl ? "image/png" : "image/svg+xml"}
          href={initialFaviconHref}
        />
        <style
          id="wh-preloaded-font-vars"
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --wh-page-font: ${initialFontCss};
              }
            `,
          }}
        />
        {initialThemeColor !== "blue" ? (
          <style
            id="wh-preloaded-theme-vars"
            dangerouslySetInnerHTML={{
              __html: `
                :root {
                  --wh-brand-50: ${palette[50]};
                  --wh-brand-100: ${palette[100]};
                  --wh-brand-200: ${palette[200]};
                  --wh-brand-300: ${palette[300]};
                  --wh-brand-400: ${palette[400]};
                  --wh-brand-500: ${palette[500]};
                  --wh-brand-600: ${palette[600]};
                  --wh-brand-700: ${palette[700]};
                  --wh-brand-800: ${palette[800]};
                  --wh-brand-900: ${palette[900]};
                  --primary: ${palette[600]};
                  --primary-hover: ${palette[700]};
                  --primary-subtle: ${palette[50]};
                  --surface-selected: ${palette[50]};
                  --ring: ${palette[500]};
                }
                .dark {
                  --primary: ${palette[400]};
                  --primary-hover: ${palette[300]};
                  --primary-subtle: color-mix(in oklab, ${palette[500]} 18%, transparent);
                  --surface-selected: color-mix(in oklab, ${palette[500]} 22%, transparent);
                  --ring: ${palette[400]};
                }
              `,
            }}
          />
        ) : null}
      </head>
      <body className={fontClasses} suppressHydrationWarning>
        <Script
          src="/remove-extension-hydration-markers.js"
          id="remove-extension-hydration-markers-external"
          strategy="beforeInteractive"
        />
        <Script
          src="/preload-sidebar-preferences.js"
          id="preload-sidebar-preferences"
          strategy="beforeInteractive"
        />
        <Providers
          initialSiteName={initialSiteName}
          initialThemeColor={initialThemeColor}
          initialDefaultFont={initialDefaultFont}
          initialLogoIcon={initialLogoIcon}
          initialCustomLogoUrl={initialCustomLogoUrl}
          initialLocale={initialLocale}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
