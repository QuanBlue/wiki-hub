import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminAiPage from "@/app/admin/ai/page";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  connections: vi.fn(async () => ({ items: [] })),
  embedding: vi.fn(async () => ({ source: "provider", model: "" })),
  summary: vi.fn(async () => ({ name: "summary" })),
  draft: vi.fn(async () => ({ name: "draft" })),
  skill: vi.fn(async (name: string) => ({ name })),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/lib/admin-ai", () => ({
  getAiConnections: m.connections,
  getEmbeddingSettings: m.embedding,
  getAiSummarySkill: m.summary,
  getAiPageDraftSkill: m.draft,
  getAiSkill: m.skill,
}));
vi.mock("@/components/admin/ai-sections", () => ({
  AiSections: (props: Record<string, { name?: string }>) => (
    <div data-testid="sections">
      {props.summarySkill.name}|{props.pageDraftSkill.name}|{props.explainSkill.name}|
      {props.translateSkill.name}|{props.writingSkill.name}|{props.suggestionsSkill.name}
    </div>
  ),
}));

function user(overrides: Partial<Me>): Me {
  return { is_superuser: false, global_permissions: [], ...overrides } as unknown as Me;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("AdminAiPage", () => {
  it.each([
    ["an ordinary member", user({})],
    ["nobody signed in", null],
  ])("explains the permission to %s instead of fetching", async (_label, me) => {
    m.getCurrentUser.mockResolvedValue(me);
    render(await AdminAiPage());
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.connections).not.toHaveBeenCalled();
  });

  it.each([
    ["a superuser", user({ is_superuser: true })],
    ["a system administrator", user({ global_permissions: ["system_admin"] })],
  ])("loads every setting for %s", async (_label, me) => {
    m.getCurrentUser.mockResolvedValue(me);
    render(await AdminAiPage());
    expect(screen.getByText("adminAi.title")).toBeInTheDocument();
    expect(screen.getByTestId("sections")).toHaveTextContent(
      "summary|draft|selection-explain|selection-translate|writing|suggestions",
    );
    // The embedding source is loaded for the Semantic search section too.
    expect(m.embedding).toHaveBeenCalled();
  });
});
