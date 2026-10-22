import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiLimitsPanel } from "@/components/admin/ai-limits-panel";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DEFAULTS = {
  requests_per_hour: null,
  translate_requests_per_hour: null,
  default_requests_per_hour: 60,
  default_translate_requests_per_hour: 1500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(DEFAULTS);
});

describe("AiLimitsPanel", () => {
  it("shows the defaults, saves a limit per hour, and goes back to the default", async () => {
    vi.mocked(api.put).mockImplementation(
      async (_url: string, body?: unknown) => ({
        ...DEFAULTS,
        ...(body as object),
      }),
    );
    const actor = userEvent.setup();
    render(<AiLimitsPanel />);

    const requests = await screen.findByLabelText("AI requests per person");
    expect(requests).toHaveAttribute("placeholder", "Default: 60");
    expect(
      screen.getByLabelText("Document translation calls per person"),
    ).toHaveAttribute("placeholder", "Default: 1500");
    const save = screen.getByRole("button", { name: "Save limits" });
    expect(save).toBeDisabled();

    await actor.type(requests, "200");
    await actor.click(save);
    expect(api.put).toHaveBeenCalledWith("/api/v1/ai/limits", {
      requests_per_hour: 200,
      translate_requests_per_hour: null,
    });

    await actor.click(
      screen.getByRole("button", { name: /Reset AI requests per person/ }),
    );
    await actor.click(screen.getByRole("button", { name: "Save limits" }));
    expect(api.put).toHaveBeenLastCalledWith("/api/v1/ai/limits", {
      requests_per_hour: null,
      translate_requests_per_hour: null,
    });
  });

  it("refuses a value outside the range before sending it", async () => {
    const actor = userEvent.setup();
    render(<AiLimitsPanel />);

    await actor.type(
      await screen.findByLabelText("AI requests per person"),
      "0",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value from 1 to 100000.",
    );
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("says when the limits cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    render(<AiLimitsPanel />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByLabelText("AI requests per person")).toBeNull();
  });

  it("keeps what was typed and says so when saving fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(api.put).mockRejectedValue(new Error("down"));
    const actor = userEvent.setup();
    render(<AiLimitsPanel />);

    const requests = await screen.findByLabelText("AI requests per person");
    await actor.type(requests, "200");
    await actor.click(screen.getByRole("button", { name: "Save limits" }));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(requests).toHaveValue("200");
  });
});
