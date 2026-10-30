import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SystemAnnouncementBanner,
  isAnnouncementActiveAt,
} from "@/components/layout/system-announcement-banner";
import { SystemAnnouncementProvider } from "@/components/layout/system-announcement-provider";
import { LocaleProvider } from "@/lib/i18n/context";
import { api } from "@/lib/api-client";
import type { SystemAnnouncement } from "@/types/api";

const { refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextContent: ({ content }: { content: string }) => (
    <div data-testid="announcement-rich-content" dangerouslySetInnerHTML={{ __html: content }} />
  ),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

function makeAnnouncement(
  overrides: Partial<SystemAnnouncement> = {},
): SystemAnnouncement {
  return {
    enabled: true,
    level: "info",
    title: "Release v2.5",
    content_html: "<p>Contact <strong>admin@wikihub.local</strong></p>",
    starts_at: null,
    expires_at: null,
    dismissible: true,
    show_on_login: true,
    updated_at: "2026-10-30T10:00:00Z",
    ...overrides,
  };
}

describe("SystemAnnouncementBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("checks active schedule boundaries accurately", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");

    expect(isAnnouncementActiveAt(null, now)).toBe(false);
    expect(isAnnouncementActiveAt(makeAnnouncement({ enabled: false }), now)).toBe(false);
    expect(
      isAnnouncementActiveAt(
        makeAnnouncement({ title: null, content_html: "<p>   </p>" }),
        now,
      ),
    ).toBe(false);

    expect(
      isAnnouncementActiveAt(
        makeAnnouncement({
          starts_at: "2026-10-30T11:00:00Z",
          expires_at: "2026-10-30T13:00:00Z",
        }),
        now,
      ),
    ).toBe(true);

    expect(
      isAnnouncementActiveAt(
        makeAnnouncement({ starts_at: "2026-10-30T13:00:00Z" }),
        now,
      ),
    ).toBe(false);

    expect(
      isAnnouncementActiveAt(
        makeAnnouncement({ expires_at: "2026-10-30T11:59:00Z" }),
        now,
      ),
    ).toBe(false);
  });

  it("renders title, rich-text content, and allows dismissal when dismissible", async () => {
    const user = userEvent.setup();
    const ann = makeAnnouncement();

    const { rerender } = render(
      <LocaleProvider initialLocale="vi">
        <SystemAnnouncementBanner announcement={ann} />
      </LocaleProvider>,
    );

    expect(screen.getByText("Release v2.5")).toBeInTheDocument();
    expect(screen.getByTestId("announcement-rich-content")).toHaveTextContent(
      "Contact admin@wikihub.local",
    );

    await user.click(screen.getByRole("button", { name: /Đóng thông báo/i }));
    expect(screen.queryByText("Release v2.5")).toBeNull();

    // When admin updates the announcement (new updated_at), it reappears automatically
    rerender(
      <LocaleProvider initialLocale="vi">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({
            title: "Updated Release v2.6",
            updated_at: "2026-10-30T15:00:00Z",
          })}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Updated Release v2.6")).toBeInTheDocument();
  });

  it("hides the close button when dismissible is false", () => {
    render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({ dismissible: false })}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Release v2.5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss announcement/i })).toBeNull();
  });

  it("lets an administrator quickly turn off or edit the announcement from the banner", async () => {
    const user = userEvent.setup();
    mockedApi.patch.mockResolvedValueOnce({} as never);

    render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement()}
          isAdmin
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: /Edit/i })).toHaveAttribute(
      "href",
      "/admin/settings?tab=announcement",
    );

    await user.click(screen.getByRole("button", { name: /Turn off/i }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({
          announcement: expect.objectContaining({ enabled: false }),
        }),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith("System announcement turned off.");
    expect(refresh).toHaveBeenCalled();
  });

  it("reads announcement and admin status from SystemAnnouncementProvider when props are omitted", () => {
    render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementProvider announcement={makeAnnouncement()} isAdmin={true}>
          <SystemAnnouncementBanner />
        </SystemAnnouncementProvider>
      </LocaleProvider>,
    );

    expect(screen.getByText("Release v2.5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/i })).toBeInTheDocument();
  });
});
