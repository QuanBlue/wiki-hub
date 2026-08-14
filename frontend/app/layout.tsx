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
          id="remove-extension-hydration-markers"
          strategy="beforeInteractive"
        >
          {`(() => {
            const isExtensionMarker = (name) =>
              name.startsWith("bis_") ||
              /^__processed_[a-f0-9-]+__$/.test(name);

            const clean = (element) => {
              if (!(element instanceof Element)) return;
              if (
                element instanceof HTMLScriptElement &&
                element.src.startsWith("chrome-extension://")
              ) {
                element.remove();
                return;
              }
              for (const attribute of Array.from(element.attributes)) {
                if (isExtensionMarker(attribute.name)) {
                  element.removeAttribute(attribute.name);
                }
              }
            };

            const cleanTree = (root) => {
              clean(root);
              if (!(root instanceof Element)) return;
              root.querySelectorAll("*").forEach(clean);
            };

            const start = () => {
              cleanTree(document.documentElement);
              const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                  if (mutation.type === "attributes") clean(mutation.target);
                  for (const node of mutation.addedNodes) cleanTree(node);
                }
              });
              observer.observe(document.documentElement, {
                attributes: true,
                childList: true,
                subtree: true,
              });
              window.addEventListener("load", () => observer.disconnect(), {
                once: true,
              });
            };

            if (document.documentElement) start();
            else document.addEventListener("DOMContentLoaded", start, { once: true });
          })();`}
        </Script>
        <Script
          id="preload-sidebar-preferences"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const root = document.documentElement;
                const storedCollapsed = window.localStorage.getItem(
                  "wikihub:sidebar-collapsed",
                );
                const collapsed =
                  storedCollapsed === null
                    ? root.dataset.whSidebarCollapsed === "true"
                    : storedCollapsed === "true";
                const storedAppWidth = window.localStorage.getItem(
                  "wikihub:sidebar-width",
                );
                const storedSpaceWidth = window.localStorage.getItem(
                  "wikihub:space-sidebar-width",
                );
                const appWidth =
                  storedAppWidth === null
                    ? Number.parseFloat(
                        root.style.getPropertyValue(
                          "--wh-preloaded-sidebar-width",
                        ),
                      )
                    : Number(storedAppWidth);
                const spaceWidth =
                  storedSpaceWidth === null
                    ? Number.parseFloat(
                        root.style.getPropertyValue(
                          "--wh-preloaded-space-sidebar-width",
                        ),
                      )
                    : Number(storedSpaceWidth);
                const isSpaceWorkspace = /^\\/spaces\\/[^/]+/.test(
                  window.location.pathname,
                );
                root.dataset.whSidebarCollapsed = String(collapsed);
                root.dataset.whSpaceWorkspace = String(isSpaceWorkspace);
                root.dataset.whSidebarHydrated = "false";
                root.style.setProperty(
                  "--wh-preloaded-sidebar-width",
                  \`\${Number.isFinite(appWidth) ? Math.min(520, Math.max(0, appWidth)) : 256}px\`,
                );
                root.style.setProperty(
                  "--wh-preloaded-space-sidebar-width",
                  \`\${Number.isFinite(spaceWidth) ? Math.min(520, Math.max(200, spaceWidth)) : 320}px\`,
                );
              } catch {
                // Storage can be blocked; the React sidebar store has the same fallback.
              }
            })();`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
