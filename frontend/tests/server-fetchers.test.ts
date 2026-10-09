import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, apiGetMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  apiGetMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: apiGetMock },
}));

import * as admin from "@/lib/admin";
import { NO_MAILBOX, getMailSummary, listAdministrators, listMailboxes } from "@/lib/admin-mail";
import { ApiError } from "@/lib/api-client";
import { ACCESS_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";
import { listMyIssues } from "@/lib/issues";
import { NO_NOTIFICATIONS, getNotificationSummary } from "@/lib/notifications";
import * as pages from "@/lib/pages";
import { getSidebarPreferences } from "@/lib/sidebar-preferences";
import * as spaces from "@/lib/spaces";

function withCookies(values: Record<string, string>) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name in values ? { value: values[name] } : undefined),
  });
}

beforeEach(() => {
  cookiesMock.mockReset();
  apiGetMock.mockReset();
  apiGetMock.mockResolvedValue([]);
  withCookies({ [ACCESS_COOKIE_NAME]: "tok" });
});

/** The path the last fetch asked for. */
function lastPath(): string {
  return apiGetMock.mock.calls.at(-1)?.[0];
}

describe("server fetchers forward the session and never cache", () => {
  it.each<[string, () => Promise<unknown>, string]>([
    ["listSpaces", () => spaces.listSpaces(), "/api/v1/spaces?include_archived=false&limit=100&offset=0"],
    ["listRecentSpaces", () => spaces.listRecentSpaces(), "/api/v1/spaces/recent"],
    ["listFavoriteSpaces", () => spaces.listFavoriteSpaces(), "/api/v1/spaces/favorites"],
    ["listTopVisitedSpaces", () => spaces.listTopVisitedSpaces(), "/api/v1/spaces/top-visited?limit=5"],
    ["getSpace", () => spaces.getSpace("A B"), "/api/v1/spaces/A%20B"],
    ["listSpaceMembers", () => spaces.listSpaceMembers("ENG"), "/api/v1/spaces/ENG/members"],
    ["listSpacePermissions", () => spaces.listSpacePermissions("ENG"), "/api/v1/spaces/ENG/permissions"],
    [
      "listSpacePermissionUsers",
      () => spaces.listSpacePermissionUsers("ENG"),
      "/api/v1/spaces/ENG/permissions/principals/users",
    ],
    [
      "listSpacePermissionGroups",
      () => spaces.listSpacePermissionGroups("ENG"),
      "/api/v1/spaces/ENG/permissions/principals/groups",
    ],
    ["listPages", () => pages.listPages("ENG"), "/api/v1/spaces/ENG/pages"],
    ["listRecentPages", () => pages.listRecentPages(), "/api/v1/pages/recent?limit=50"],
    ["getPublicUser", () => pages.getPublicUser("an na"), "/api/v1/users/an%20na/profile"],
    ["listUserActivity", () => pages.listUserActivity("an"), "/api/v1/users/an/activity?limit=20"],
    [
      "listUserActivity with a cursor",
      () => pages.listUserActivity("an", "c1"),
      "/api/v1/users/an/activity?limit=20&cursor=c1",
    ],
    ["getUserProfileStats", () => pages.getUserProfileStats("an"), "/api/v1/users/an/stats"],
    ["listUserDrafts", () => pages.listUserDrafts("an"), "/api/v1/users/an/drafts"],
    ["listOwnPinnedPages", () => pages.listOwnPinnedPages(), "/api/v1/users/me/pins"],
    ["listOwnLikedPages", () => pages.listOwnLikedPages(), "/api/v1/users/me/likes"],
    ["listOwnPageLabels", () => pages.listOwnPageLabels(), "/api/v1/users/me/page-labels"],
    ["listOwnFavoriteSpaces", () => pages.listOwnFavoriteSpaces(), "/api/v1/spaces/favorites"],
    ["listOwnUserTags", () => pages.listOwnUserTags(), "/api/v1/users/me/tags"],
    ["getPage", () => pages.getPage("ENG", "a/b"), "/api/v1/spaces/ENG/pages/a%2Fb"],
    ["listMyIssues", () => listMyIssues(), "/api/v1/issues/mine?limit=20&offset=0"],
    ["listMailboxes", () => listMailboxes(), "/api/v1/admin-mail/mailboxes"],
    ["listAdministrators", () => listAdministrators(), "/api/v1/users/administrators"],
    ["admin.listAdministrators", () => admin.listAdministrators(), "/api/v1/users/administrators"],
    [
      "admin.listPermissionOverrideUsers",
      () => admin.listPermissionOverrideUsers(),
      "/api/v1/users/permission-overrides",
    ],
  ])("%s", async (_name, call, path) => {
    await call();

    expect(lastPath()).toBe(path);
    expect(apiGetMock.mock.calls.at(-1)?.[1]).toMatchObject({
      cache: "no-store",
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=tok` },
    });
  });

  it("sends no cookie header when signed out", async () => {
    withCookies({});
    await spaces.getSpace("ENG");
    await pages.listPages("ENG");

    for (const call of apiGetMock.mock.calls) expect(call[1].headers).toEqual({});
  });

  it("pages through the whole space directory", async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({ key: `S${index}` }));
    apiGetMock.mockResolvedValueOnce(full).mockResolvedValueOnce([{ key: "LAST" }]);

    const all = await spaces.listAllSpaces(true);

    expect(all).toHaveLength(201);
    expect(lastPath()).toBe("/api/v1/spaces?include_archived=true&limit=200&offset=200");
  });
});

describe("shell summaries never take the page down", () => {
  it("returns the summaries when they load", async () => {
    apiGetMock.mockResolvedValue({ unread_count: 3 });
    expect(await getMailSummary()).toEqual({ unread_count: 3 });
    expect(await getNotificationSummary()).toEqual({ unread_count: 3 });
  });

  it("falls back to nothing new when the backend fails", async () => {
    apiGetMock.mockRejectedValue(new Error("down"));
    expect(await getMailSummary()).toBe(NO_MAILBOX);
    expect(await getNotificationSummary()).toBe(NO_NOTIFICATIONS);
  });
});

describe("getCurrentUser", () => {
  it("is signed out without a session cookie, without asking the backend", async () => {
    withCookies({});
    expect(await getCurrentUser()).toBeNull();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("returns the user the backend vouches for", async () => {
    apiGetMock.mockResolvedValue({ username: "an" });
    expect(await getCurrentUser()).toEqual({ username: "an" });
  });

  it.each([401, 403])("treats a %i as signed out", async (status) => {
    apiGetMock.mockRejectedValue(new ApiError(status, "nope", "unauthorized"));
    expect(await getCurrentUser()).toBeNull();
  });

  it("surfaces an outage rather than signing the user out", async () => {
    apiGetMock.mockRejectedValue(new ApiError(503, "down", "unavailable"));
    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getSidebarPreferences", () => {
  it("reads the saved state, clamping widths to their bounds", async () => {
    withCookies({
      wikihub_sidebar_collapsed: "true",
      wikihub_sidebar_width: "900",
      wikihub_space_sidebar_width: "50",
    });

    expect(await getSidebarPreferences()).toEqual({
      collapsed: true,
      appWidth: 520,
      spaceWidth: 200,
    });
  });

  it("falls back to the defaults for missing or unreadable values", async () => {
    withCookies({ wikihub_sidebar_width: "wide" });

    expect(await getSidebarPreferences()).toEqual({
      collapsed: false,
      appWidth: 256,
      spaceWidth: 320,
    });
  });
});

describe("getServerLocale", () => {
  it("uses the saved locale", async () => {
    withCookies({ wikihub_locale: "vi" });
    const { locale, t } = await getServerLocale();

    expect(locale).toBe("vi");
    expect(typeof t("nav.home")).toBe("string");
  });

  it("defaults to English for an unknown value or outside a request", async () => {
    withCookies({ wikihub_locale: "fr" });
    expect((await getServerLocale()).locale).toBe("en");

    cookiesMock.mockRejectedValue(new Error("no request scope"));
    expect((await getServerLocale()).locale).toBe("en");
  });
});
