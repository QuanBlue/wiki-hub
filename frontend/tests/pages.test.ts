import { describe, expect, it } from "vitest";

import { findPageByRouteSlug } from "@/lib/pages";
import type { WikiPage } from "@/types/api";

const samplePage = {
  id: "page-1",
  space_id: "space-1",
  parent_id: null,
  title: "Trung tâm KHDN",
  slug: "1-trungtam-khdnmn",
  content: "<p>Content</p>",
  content_format: "html",
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  created_by_username: null,
  updated_by_username: null,
  can_edit: true,
  can_export: true,
} satisfies WikiPage;

describe("findPageByRouteSlug", () => {
  it("finds pages with differently cased or encoded route slugs", () => {
    expect(findPageByRouteSlug([samplePage], "1-TRUNGTAM-KHDNMN")).toBe(
      samplePage,
    );
    expect(findPageByRouteSlug([samplePage], "1-trungtam-khdnmn")).toBe(
      samplePage,
    );
  });
});
