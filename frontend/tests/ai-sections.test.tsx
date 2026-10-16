import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiSections } from "@/components/admin/ai-sections";
import type { AiConnection } from "@/lib/admin-ai";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const connection: AiConnection = {
  id: "c1",
  name: "Codev",
  base_url: "http://gw/v1",
  model: "a/one",
  api_key_preview: "sk-adc2****297a",
  is_active: true,
  last_checked_at: null,
  last_check_ok: null,
  created_at: "2026-10-13T08:00:00Z",
};

function renderSections() {
  render(
    <AiSections
      connections={{ items: [connection] }}
      summarySkill={{ instructions: "", default_instructions: "Write a TL;DR.", is_custom: false }}
    />,
  );
}

describe("AiSections", () => {
  it("starts on key management with skills a click away", async () => {
    renderSections();

    expect(screen.getByRole("tab", { name: "Key management" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Skill management" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("heading", { name: "Key management", level: 3 })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    // The hidden panel is out of the accessibility tree until it is chosen.
    expect(screen.queryByRole("textbox", { name: "Instructions" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Skill management" }));

    expect(screen.getByRole("tab", { name: "Skill management" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Page summary (TL;DR)")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("has a Semantic search section between keys and skills, off until chosen", async () => {
    vi.mocked(api.get).mockResolvedValue({ available: true, enabled: false, total: 0, indexed: 0, error: null });
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [], error: null });
    renderSections();

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Key management", "Semantic search", "Skill management"]);
    // Hidden until chosen, and doing nothing in the meantime (no request for models).
    expect(screen.queryByRole("heading", { name: "Semantic search", level: 3 })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: "Semantic search" }));

    expect(screen.getByRole("heading", { name: "Semantic search", level: 3 })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Self-hosted \(Ollama\)/ })).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the key table as it was when you switch away and back", async () => {
    renderSections();

    await userEvent.click(screen.getByRole("tab", { name: "Skill management" }));
    await userEvent.click(screen.getByRole("tab", { name: "Key management" }));

    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("sk-adc2****297a")).toBeVisible();
  });
});
