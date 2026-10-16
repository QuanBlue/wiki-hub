import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebSearchPanel } from "@/components/admin/web-search-panel";
import { api, ApiError } from "@/lib/api-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const OFF = {
  enabled: false,
  provider: "gateway" as const,
  has_key: false,
  key_preview: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(OFF);
});

describe("WebSearchPanel", () => {
  it("shows what the chosen service is, with the sentence that sets it apart, and changes it", async () => {
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    expect(await screen.findByText(/built-in web search/)).toBeInTheDocument();
    await actor.click(
      screen.getByLabelText("Search service", { selector: "button" }),
    );
    await actor.click(
      await screen.findByRole("menuitemradio", { name: /Brave Search/ }),
    );

    expect(screen.getByText(/Brave runs its own index/)).toBeInTheDocument();
    // A service with a key of its own asks for it.
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
  });

  it("clears an earlier test result when another service is chosen", async () => {
    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      error: null,
      results: 5,
    });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    await actor.click(
      await screen.findByRole("button", { name: "Test search" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("5 results");

    await actor.click(
      screen.getByLabelText("Search service", { selector: "button" }),
    );
    await actor.click(
      await screen.findByRole("menuitemradio", { name: /Serper/ }),
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says why a test failed, from the server's words or its own", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ok: false,
      error: "The search service did not accept the key.",
      results: 0,
    });
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(503, "service_unavailable", "Not reachable."),
    );
    vi.mocked(api.post).mockResolvedValueOnce({
      ok: false,
      error: null,
      results: 0,
    });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);
    const test = await screen.findByRole("button", { name: "Test search" });

    await actor.click(test);
    expect(
      await screen.findByText("The search service did not accept the key."),
    ).toBeInTheDocument();

    await actor.click(test);
    expect(await screen.findByText("Not reachable.")).toBeInTheDocument();

    await actor.click(test);
    expect(
      await screen.findByText("The search could not be tested."),
    ).toBeInTheDocument();
  });

  it("says when the settings could not be saved", async () => {
    vi.mocked(api.put).mockRejectedValue(
      new ApiError(
        400,
        "bad_request",
        "Enter the key of the search service before turning it on.",
      ),
    );
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    await actor.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Enter the key of the search service before turning it on.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("saves the choice and tells the person so", async () => {
    vi.mocked(api.put).mockResolvedValue({ ...OFF, enabled: true });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    await actor.click(
      await screen.findByRole("checkbox", {
        name: /Allow the chat to search the internet/,
      }),
    );
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/web-search", {
        enabled: true,
        provider: "gateway",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Web search settings saved.");
  });

  it("does not touch the panel once it has gone before the settings arrive", async () => {
    let arrive!: (value: typeof OFF) => void;
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => (arrive = resolve)),
    );
    const { unmount } = render(<WebSearchPanel />);

    unmount();
    arrive(OFF);

    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it("does not report a failure to load once it has gone", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(api.get).mockReturnValue(
      new Promise((_resolve, reject) => (fail = reject)),
    );
    const { unmount } = render(<WebSearchPanel />);

    unmount();
    fail(new Error("late"));

    await expect(Promise.resolve()).resolves.toBeUndefined();
  });
});
