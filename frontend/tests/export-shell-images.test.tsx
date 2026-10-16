import { render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { ExportShell } from "@/components/print/export-shell";
import type { ExportBundle } from "@/types/api";

// The real editor draws images asynchronously; a stand-in that has them in the
// DOM when it reports ready lets the shell's wait-for-images path be exercised.
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextContent: ({ onReady }: { onReady?: () => void }) => {
    useEffect(() => onReady?.(), [onReady]);
    return (
      <div>
        <img alt="a" src="/a.png" />
        <img alt="b" src="/b.png" />
        <img alt="c" src="/c.png" />
      </div>
    );
  },
}));

const bundle = {
  page: { id: "1", title: "Runbook", slug: "runbook", content: "" },
  space: { key: "ENG", name: "Engineering", font_family: null },
  site: { site_name: "WikiHub", theme_color: "blue", default_font: "inter" },
  theme: "light",
  fmt: "pdf",
} as unknown as ExportBundle;

describe("ExportShell images", () => {
  it("waits for images that have not finished loading, even if one is broken", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    const broken = vi.fn().mockRejectedValue(new Error("broken"));
    const queue = [decode, broken];
    let n = 0;
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      // The first two are still loading; the last one already finished.
      get: () => n++ >= 2,
    });
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value() {
        return queue.shift()!();
      },
    });
    try {
      render(
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <ExportShell bundle={bundle} />
        </ThemeProvider>,
      );
      await waitFor(() => expect(document.body.dataset.exportReady).toBe("true"));
      expect(decode).toHaveBeenCalledTimes(1);
      expect(broken).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(HTMLImageElement.prototype, "complete");
      Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
    }
  });
});
