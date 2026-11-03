import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    document.cookie = "wikihub_locale=; max-age=0; path=/";
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

  it("shows only the Edit button for administrators, avoiding accidental turn off or dismissal", () => {
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
    expect(screen.queryByRole("button", { name: /Turn off/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss announcement/i })).toBeNull();
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

  it("handles null announcement or inactive schedule by returning null", () => {
    const { container, rerender } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={null} />
      </LocaleProvider>,
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({ starts_at: "2099-01-01T00:00:00Z" })}
        />
      </LocaleProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders preview mode with placeholder in English and Vietnamese when empty", () => {
    const emptyAnn = makeAnnouncement({ title: null, content_html: "" });

    const { unmount } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={emptyAnn} previewMode />
      </LocaleProvider>,
    );
    expect(
      screen.getByText(
        "Type a headline or message below — your top announcement bar will look like this.",
      ),
    ).toBeInTheDocument();
    unmount();

    render(
      <LocaleProvider initialLocale="vi">
        <SystemAnnouncementBanner announcement={emptyAnn} previewMode />
      </LocaleProvider>,
    );
    expect(
      screen.getByText(
        "Nhập tiêu đề hoặc nội dung bên dưới — thanh thông báo trên cùng sẽ hiển thị như thế này.",
      ),
    ).toBeInTheDocument();
  });

  it("renders only title or only body, and handles img tag in body", () => {
    const { rerender } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={makeAnnouncement({ content_html: "" })} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Release v2.5")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-rich-content")).toBeNull();

    rerender(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({ title: null, content_html: "<p>Body only</p>" })}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByText("Release v2.5")).toBeNull();
    expect(screen.getByTestId("announcement-rich-content")).toHaveTextContent("Body only");

    rerender(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({
            title: null,
            content_html: '<img src="/test.png" alt="preview" />',
          })}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("announcement-rich-content")).toBeInTheDocument();
  });

  it("renders different levels and alert/status roles", () => {
    const { rerender } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={makeAnnouncement({ level: "danger" })} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={makeAnnouncement({ level: "warning" })} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={makeAnnouncement({ level: "success" })} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders expires_at badge in English and Vietnamese", () => {
    const expiresAt = "2030-10-31T15:30:00Z";
    const { unmount } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({ expires_at: expiresAt })}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/Until/)).toBeInTheDocument();
    unmount();

    render(
      <LocaleProvider initialLocale="vi">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({ expires_at: expiresAt })}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/Đến/)).toBeInTheDocument();
  });

  it("handles fallback signature computation when updated_at is missing and handles storage exceptions", async () => {
    const user = userEvent.setup();
    const ann = makeAnnouncement({
      updated_at: undefined,
      title: null,
      content_html: "<p>Text</p>",
      starts_at: null,
      expires_at: null,
    });

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage quota exceeded");
    });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage security error");
    });

    render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner announcement={ann} />
      </LocaleProvider>,
    );

    const dismissBtn = screen.getByRole("button", { name: /Dismiss announcement/i });
    await user.click(dismissBtn);

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it("handles overflow expand/collapse toggle in English and Vietnamese", async () => {
    const user = userEvent.setup();
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      value: 120,
    });

    try {
      const { unmount } = render(
        <LocaleProvider initialLocale="en">
          <SystemAnnouncementBanner announcement={makeAnnouncement()} />
        </LocaleProvider>,
      );

      const expandBtn = screen.getByRole("button", { name: /Show more/i });
      expect(expandBtn).toBeInTheDocument();
      await user.click(expandBtn);

      expect(screen.getByRole("button", { name: /Show less/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Show less/i }));
      expect(screen.getByRole("button", { name: /Show more/i })).toBeInTheDocument();
      unmount();

      render(
        <LocaleProvider initialLocale="vi">
          <SystemAnnouncementBanner announcement={makeAnnouncement()} />
        </LocaleProvider>,
      );

      const expandBtnVi = screen.getByRole("button", { name: /Xem thêm/i });
      expect(expandBtnVi).toBeInTheDocument();
      await user.click(expandBtnVi);
      expect(screen.getByRole("button", { name: /Thu gọn/i })).toBeInTheDocument();
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as any).scrollHeight;
      }
    }
  });

  it("sets up an interval when starts_at or expires_at is present", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    const { unmount } = render(
      <LocaleProvider initialLocale="en">
        <SystemAnnouncementBanner
          announcement={makeAnnouncement({
            starts_at: "2026-10-30T10:00:00Z",
          })}
        />
      </LocaleProvider>,
    );

    expect(setIntervalSpy).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
