import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { describe, expect, it } from "vitest";

import { ExportError } from "@/components/print/export-error";
import { ExportShell } from "@/components/print/export-shell";
import type { ExportBundle } from "@/types/api";

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    page: {
      id: "1",
      title: "Runbook",
      slug: "runbook",
      content: "<p>Hello export</p>",
    },
    space: { key: "ENG", name: "Engineering", font_family: null },
    site: { site_name: "WikiHub", theme_color: "blue", default_font: "inter" },
    theme: "light",
    ...overrides,
  };
}

function renderWithTheme(node: React.ReactNode) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {node}
    </ThemeProvider>,
  );
}

describe("ExportShell", () => {
  it("renders the page title and content, and signals readiness", async () => {
    renderWithTheme(<ExportShell bundle={bundle()} />);

    expect(await screen.findByText("Runbook")).toBeVisible();
    expect(await screen.findByText("Hello export")).toBeVisible();

    await waitFor(() =>
      expect(document.body.dataset.exportReady).toBe("true"),
    );
  });

  it("marks the export root with data-export on the document element", async () => {
    renderWithTheme(<ExportShell bundle={bundle()} />);

    await waitFor(() =>
      expect(document.documentElement.dataset.export).toBe("true"),
    );
  });

  it("applies the space's font override as a CSS variable", async () => {
    const { container } = renderWithTheme(
      <ExportShell bundle={bundle({ space: { key: "ENG", name: "Engineering", font_family: "roboto" } })} />,
    );

    const root = await screen.findByText("Runbook");
    const wrapper = container.querySelector("[data-export-root]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.getPropertyValue("--wh-space-page-font")).toContain(
      "Roboto",
    );
    expect(root).toBeVisible();
  });

  it("does not set a font override for the default/inherit sentinels", async () => {
    const { container } = renderWithTheme(
      <ExportShell bundle={bundle({ space: { key: "ENG", name: "Engineering", font_family: "inherit" } })} />,
    );

    await screen.findByText("Runbook");
    const wrapper = container.querySelector("[data-export-root]") as HTMLElement;
    expect(wrapper.style.getPropertyValue("--wh-space-page-font")).toBe("");
  });
});

describe("ExportError", () => {
  it("marks the export as failed on document.body with the given reason", async () => {
    render(<ExportError reason="missing-token" />);

    await waitFor(() =>
      expect(document.body.dataset.exportError).toBe("missing-token"),
    );
    expect(
      screen.getByText("This export link is missing or invalid."),
    ).toBeVisible();
  });

  it("shows a custom message when one is given", () => {
    render(<ExportError reason="fetch-failed" message="Export permission is required." />);
    expect(
      screen.getByText("Export permission is required."),
    ).toBeVisible();
  });
});
