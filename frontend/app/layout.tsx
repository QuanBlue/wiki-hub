import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import type { CSSProperties } from "react";

import { Providers } from "@/components/providers";
import { SITE_NAME } from "@/lib/env";
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
const LOGO_ICON_COOKIE = "wikihub_logo_icon";

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

  let initialThemeColor =
    preferenceCookies.get(THEME_COLOR_COOKIE)?.value || "blue";
  let initialLogoIcon =
    preferenceCookies.get(LOGO_ICON_COOKIE)?.value || "default";
  let initialCustomLogoUrl: string | null = null;

  try {
    const meta = await serverGet<InstanceInfo>("/api/v1/meta");
    if (meta) {
      if (meta.theme_color) initialThemeColor = meta.theme_color;
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

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-wh-sidebar-collapsed={String(sidebarCollapsed)}
      data-wh-sidebar-hydrated="false"
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
      <body
        className={`${inter.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
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
          initialThemeColor={initialThemeColor}
          initialLogoIcon={initialLogoIcon}
          initialCustomLogoUrl={initialCustomLogoUrl}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
