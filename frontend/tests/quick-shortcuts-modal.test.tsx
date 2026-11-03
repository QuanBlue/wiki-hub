import {
  act,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickShortcutsModal } from "@/components/layout/quick-shortcuts-modal";
import { LocaleProvider } from "@/lib/i18n/context";
import {
  openCheatSheet,
  SEARCH_OPEN_EVENT,
} from "@/lib/cheat-sheet";

describe("QuickShortcutsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when triggered by openCheatSheet() event", () => {
    render(<QuickShortcutsModal />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      openCheatSheet();
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("toggles when ? key is pressed outside of inputs", () => {
    render(<QuickShortcutsModal />);

    // Press '?'
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press '?' again to toggle off
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not toggle ? key when user is focused inside an input or textarea", () => {
    render(
      <div>
        <input data-testid="test-input" />
        <QuickShortcutsModal />
      </div>,
    );

    const input = screen.getByTestId("test-input");
    input.focus();

    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("allows switching tabs between shortcuts, search, editor, and features", () => {
    render(<QuickShortcutsModal />);

    act(() => {
      openCheatSheet();
    });

    // Default tab is shortcuts
    expect(screen.getByText("Open quick search")).toBeInTheDocument();

    // Switch to Search syntax tab
    const searchTab = screen.getByRole("button", { name: /Cú pháp tìm kiếm|Search syntax/i });
    fireEvent.click(searchTab);
    expect(screen.getByText("space:KEY")).toBeInTheDocument();
    expect(screen.getByText(/:ask (câu hỏi|question)/i)).toBeInTheDocument();

    // Switch to Editor tab
    const editorTab = screen.getByRole("button", { name: /Lệnh soạn thảo|Editor commands/i });
    fireEvent.click(editorTab);
    expect(screen.getByText("/table")).toBeInTheDocument();
    expect(screen.getByText("/callout")).toBeInTheDocument();

    // Switch to Features tab
    const featuresTab = screen.getByRole("button", { name: /Tính năng nổi bật|Highlights/i });
    fireEvent.click(featuresTab);
    expect(
      screen.getByText(/Chỉnh sửa Word, Excel, PowerPoint|In-place Word, Excel/i),
    ).toBeInTheDocument();
  });

  it("explains each guide tab in Vietnamese", () => {
    render(
      <LocaleProvider initialLocale="vi">
        <QuickShortcutsModal />
      </LocaleProvider>,
    );
    act(() => openCheatSheet());
    expect(screen.getByText(/Mở bảng tra cứu phím tắt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cú pháp tìm kiếm|Search syntax/i }));
    expect(screen.getByText(/Nhập các tiền tố này/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Lệnh soạn thảo|Editor commands/i }));
    expect(screen.getByText(/Trong trình soạn thảo trang/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tính năng nổi bật|Highlights/i }));
    expect(screen.getByText(/Những tính năng đặc biệt/)).toBeInTheDocument();
  });

  it("fires search open event when clicking Try command in search syntax tab", () => {
    const searchListener = vi.fn();
    window.addEventListener(SEARCH_OPEN_EVENT, searchListener);

    render(<QuickShortcutsModal />);

    act(() => {
      openCheatSheet({ initialTab: "search" });
    });

    const tryButtons = screen.getAllByRole("button", { name: /Thử ngay|Try now/i });
    expect(tryButtons.length).toBeGreaterThan(0);

    fireEvent.click(tryButtons[0]!);

    expect(searchListener).toHaveBeenCalled();
    // Modal closes
    expect(screen.queryByRole("dialog")).toBeNull();

    window.removeEventListener(SEARCH_OPEN_EVENT, searchListener);
  });
});
