import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import type { CSSProperties } from "react";

import { Providers } from "@/components/providers";
import { SITE_NAME } from "@/lib/env";

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
      <head suppressHydrationWarning />
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
