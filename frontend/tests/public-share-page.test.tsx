import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import PublicSharePage from "@/app/share/[token]/page";
import { ApiError, api } from "@/lib/api-client";
import type { PublicShareView } from "@/types/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

// Mock RichTextContent
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextContent: ({ content }: { content: string }) => (
    <div data-testid="rich-text-content" dangerouslySetInnerHTML={{ __html: content }} />
  ),
}));

describe("PublicSharePage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it("shows disabled error screen when public sharing is disabled system-wide", async () => {
    vi.mocked(api.get).mockRejectedValue(
      new ApiError(403, "permission_denied", "Public sharing is disabled on this system."),
    );

    render(<PublicSharePage params={Promise.resolve({ token: "test-token" })} />);

    expect(await screen.findByText("Public sharing disabled")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The system administrator has currently disabled public external link sharing.",
      ),
    ).toBeInTheDocument();
  });

  it("shows expired error screen when link is expired", async () => {
    vi.mocked(api.get).mockRejectedValue(
      new ApiError(410, "share_expired", "This share link has expired."),
    );

    render(<PublicSharePage params={Promise.resolve({ token: "expired-token" })} />);

    expect(await screen.findByText("Share link expired")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This document share link has expired as scheduled by the author.",
      ),
    ).toBeInTheDocument();
  });

  it("shows missing and unexpected load errors", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(404, "not_found", "Missing link"),
    );
    const missing = render(<PublicSharePage params={Promise.resolve({ token: "missing" })} />);
    expect(await screen.findByText("Document not found")).toBeInTheDocument();
    missing.unmount();

    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    render(<PublicSharePage params={Promise.resolve({ token: "offline" })} />);
    expect(await screen.findByText("Document not found")).toBeInTheDocument();
  });

  it("shows verification errors and toggles password visibility", async () => {
    vi.mocked(api.get).mockResolvedValue({
      title: "Secret", content_html: "", space_key: "ENG", space_name: "Engineering",
      created_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
      expires_at: null, has_password: true, is_password_verified: false, view_count: 0,
    });
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError(403, "disabled", "Link disabled"))
      .mockRejectedValueOnce(new Error("offline"));
    render(<PublicSharePage params={Promise.resolve({ token: "secret" })} />);
    const input = await screen.findByPlaceholderText("Enter document password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    await userEvent.type(input, "secret");
    await userEvent.click(screen.getByRole("button", { name: "Unlock document" }));
    expect(await screen.findByText("Link disabled")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unlock document" }));
    expect(await screen.findByText("Incorrect password. Please try again.")).toBeInTheDocument();
  });

  it("prompts for password and unlocks document upon submitting correct password", async () => {
    const protectedMeta: PublicShareView = {
      title: "Quarterly Financials",
      content_html: "",
      space_key: "FIN",
      space_name: "Finance",
      created_at: "2026-11-01T08:00:00Z",
      updated_at: "2026-11-01T08:00:00Z",
      expires_at: null,
      has_password: true,
      is_password_verified: false,
      view_count: 5,
    };

    const unlockedData: PublicShareView = {
      ...protectedMeta,
      content_html: "<p>Confidential numbers</p>",
      is_password_verified: true,
      view_count: 6,
    };

    vi.mocked(api.get).mockResolvedValue(protectedMeta);
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError(401, "invalid_password", "Incorrect password"))
      .mockResolvedValueOnce(unlockedData);

    render(<PublicSharePage params={Promise.resolve({ token: "pw-token" })} />);

    expect(await screen.findByText("Password Protected Document")).toBeInTheDocument();
    expect(screen.getByText("Quarterly Financials")).toBeInTheDocument();

    const pwInput = screen.getByPlaceholderText("Enter document password");
    await userEvent.type(pwInput, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Unlock document" }));

    // Wrong password error
    expect(
      await screen.findByText("Incorrect password. Please try again."),
    ).toBeInTheDocument();

    // Type correct password
    await userEvent.clear(pwInput);
    await userEvent.type(pwInput, "correct");
    await userEvent.click(screen.getByRole("button", { name: "Unlock document" }));

    // Unlocked view rendered
    expect(await screen.findByText("Confidential numbers")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("6 views")).toBeInTheDocument();
  });

  it("renders open document directly without password and allows copying link", async () => {
    const publicDoc: PublicShareView = {
      title: "Public Roadmap",
      content_html: "<p>Q1 Goals and Deliverables</p>",
      space_key: "PROD",
      space_name: "Product",
      created_at: "2026-11-01T08:00:00Z",
      updated_at: "2026-11-02T08:00:00Z",
      expires_at: "2026-11-15T08:00:00Z",
      has_password: false,
      is_password_verified: true,
      view_count: 12,
    };

    vi.mocked(api.get).mockResolvedValue(publicDoc);

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<PublicSharePage params={Promise.resolve({ token: "open-token" })} />);

    expect(await screen.findByText("Public Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Q1 Goals and Deliverables")).toBeInTheDocument();
    expect(screen.getByText("Read-only shared document")).toBeInTheDocument();

    // Copy link button
    const copyBtn = screen.getByRole("button", { name: /Copy link/i });
    await userEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Link copied!");

    const width = screen.getByRole("button", { name: "Normal width" });
    await userEvent.click(width);
    expect(screen.getByRole("button", { name: "Full width" })).toHaveAttribute(
      "aria-pressed", "false",
    );
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Print / Export" }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it("omits the view count for a newly shared document", async () => {
    vi.mocked(api.get).mockResolvedValue({
      title: "New public page", content_html: "<p>Content</p>",
      space_key: "ENG", space_name: "Engineering",
      created_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
      expires_at: null, has_password: false, is_password_verified: true, view_count: 0,
    });
    render(<PublicSharePage params={Promise.resolve({ token: "new" })} />);
    expect(await screen.findByText("New public page")).toBeInTheDocument();
    expect(screen.queryByText(/views$/)).not.toBeInTheDocument();
  });
});
