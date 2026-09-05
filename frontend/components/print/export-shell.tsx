"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { RichTextContent } from "@/components/pages/rich-text-editor";
import { getFontFamilyCss } from "@/lib/font-presets";
import type { ExportBundle } from "@/types/api";

/**
 * The chrome-less body the headless-browser export visits.
 *
 * No sidebar, no topbar, no page actions - just the title and the page's
 * content rendered through the exact same RichTextContent used on the live
 * page, so PDF/HTML/Word capture the real thing rather than a second
 * approximation of it. Once everything that could still be loading has
 * settled, it signals `document.body.dataset.exportReady = "true"`, which is
 * what the backend's Playwright capture waits on before taking its snapshot.
 *
 * Deliberately no sleeps anywhere: every step below waits on a real signal
 * (fonts, image decode, one settled paint), because a fixed delay is either
 * too short under load or wastes time when the page is already ready.
 */
export function ExportShell({ bundle }: { bundle: ExportBundle }) {
  const { setTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const signaledRef = useRef(false);

  // A static document has no viewer-side dark-mode toggle to honour, so
  // export always renders the bundle's fixed theme regardless of whatever
  // this browser context happened to inherit.
  useEffect(() => {
    setTheme(bundle.theme);
    document.documentElement.dataset.export = "true";
  }, [setTheme, bundle.theme]);

  // If content somehow never finishes settling (a stuck font load, a broken
  // image URL that never resolves or rejects), fail the capture cleanly
  // instead of leaving Playwright to hang until its own timeout with no
  // indication of what went wrong.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!signaledRef.current) {
        document.body.dataset.exportError = "timeout";
      }
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleContentReady = useCallback(() => {
    // Fires once per mount (RichTextContent only calls onReady when its
    // editor first exists); the guard just makes a second call harmless.
    if (signaledRef.current) return;

    const signalReady = () => {
      if (signaledRef.current) return;
      signaledRef.current = true;
      document.body.dataset.exportReady = "true";
    };

    const waitForSettledPaint = () => {
      // Two nested frames: the first is scheduled before the browser has
      // necessarily painted the just-applied DOM; the second runs only
      // after that paint has happened.
      requestAnimationFrame(() => {
        requestAnimationFrame(signalReady);
      });
    };

    const images = rootRef.current
      ? Array.from(rootRef.current.querySelectorAll("img"))
      : [];
    // The Font Loading API is universal in the Chromium the export renders
    // in; the fallback only matters for jsdom, which doesn't implement it.
    const fontsReady = document.fonts?.ready ?? Promise.resolve();

    Promise.all([
      fontsReady,
      ...images.map((img) =>
        img.complete ? Promise.resolve() : img.decode().catch(() => undefined),
      ),
    ]).then(waitForSettledPaint, waitForSettledPaint);
  }, []);

  const spaceFontStyle =
    bundle.space.font_family &&
    bundle.space.font_family !== "inherit" &&
    bundle.space.font_family !== "default"
      ? ({
          "--wh-space-page-font": getFontFamilyCss(bundle.space.font_family),
        } as CSSProperties)
      : undefined;

  return (
    <div
      ref={rootRef}
      data-export-root
      className={
        // A PDF is a fixed physical page - a comfortable, book-like reading
        // column is correct there. A standalone HTML file, opened in an
        // ordinary browser window, has no such page: capped to the same
        // narrow column, it renders as a sliver down the middle of the
        // window rather than using the width the reader actually has.
        bundle.fmt === "html"
          ? "mx-auto w-full max-w-none px-10 py-10"
          : "mx-auto max-w-4xl px-10 py-10"
      }
      style={spaceFontStyle}
    >
      <h1 className="mb-6 text-3xl font-bold" style={{ fontFamily: "var(--font-page)" }}>
        {bundle.page.title}
      </h1>
      <RichTextContent
        content={bundle.page.content}
        exportMode
        onReady={handleContentReady}
      />
    </div>
  );
}
