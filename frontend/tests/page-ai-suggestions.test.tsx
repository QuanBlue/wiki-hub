import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => vi.resetModules());

const SUGGESTIONS = {
  labels: [
    { name: "monitoring", existing: true },
    { name: "prometheus", existing: false },
    { name: "Grafana", existing: false },
  ],
  related: [
    {
      id: "p1",
      title: "Alerting rules",
      slug: "alerting-rules",
      space_key: "OPS",
      space_name: "Operations",
    },
  ],
  cached: false,
};

async function mount(enabled = true, labelNames: string[] = ["grafana"]) {
  const { PageAiSuggestions } =
    await import("@/components/pages/page-ai-suggestions");
  const { api } = await import("@/lib/api-client");
  vi.mocked(api.get).mockResolvedValue({ enabled, can_configure: false });
  const onAddLabel = vi.fn().mockResolvedValue(true);
  render(
    <PageAiSuggestions
      spaceKey="ENG"
      slug="runbook"
      labelNames={labelNames}
      onAddLabel={onAddLabel}
    />,
  );
  return { api: vi.mocked(api), onAddLabel };
}

describe("PageAiSuggestions", () => {
  it("asks only when the button is pressed, then offers labels and related pages", async () => {
    const { api, onAddLabel } = await mount();
    api.post.mockResolvedValue(SUGGESTIONS);
    const button = await screen.findByRole("button", {
      name: "Suggest labels and related pages",
    });
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(button);

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/pages/runbook/suggest",
    );
    expect(
      await screen.findByRole("button", { name: "prometheus" }),
    ).toBeInTheDocument();
    // A label the page already has (any case) is not offered again.
    expect(screen.queryByRole("button", { name: "Grafana" })).toBeNull();
    // One the author already uses elsewhere is marked as theirs.
    expect(screen.getByRole("button", { name: "monitoring" })).toHaveAttribute(
      "title",
      "A label you already use",
    );
    expect(
      screen.getByRole("link", { name: /Alerting rules/ }),
    ).toHaveAttribute("href", "/spaces/OPS/pages/alerting-rules");

    await userEvent.click(screen.getByRole("button", { name: "prometheus" }));
    expect(onAddLabel).toHaveBeenCalledWith("prometheus");
  });

  it("is switched off, with a hint, while the assistant is not set up", async () => {
    const { api } = await mount(false);

    const button = await screen.findByRole("button", {
      name: "Suggest labels and related pages",
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText("Turn on the AI assistant to get suggestions."),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to suggest", async () => {
    const { api } = await mount();
    api.post.mockResolvedValue({ labels: [], related: [], cached: false });

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Suggest labels and related pages",
      }),
    );

    expect(
      await screen.findByText("No suggestions for this page yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest again" })).toBeEnabled();
  });

  it("shows a failure in red inside the section", async () => {
    const { api } = await mount();
    api.post.mockRejectedValue(
      new ApiError(429, "rate_limited", "Too many AI requests."),
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Suggest labels and related pages",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Too many AI requests.",
      ),
    );
  });

  it("falls back to a general message for a failure that carries none", async () => {
    const { api } = await mount();
    api.post.mockRejectedValue(new Error("offline"));

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Suggest labels and related pages",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The AI assistant could not answer right now.",
      ),
    );
  });

  it("shows it is working while it asks again", async () => {
    const { api } = await mount();
    api.post.mockResolvedValueOnce(SUGGESTIONS);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Suggest labels and related pages",
      }),
    );
    const again = await screen.findByRole("button", { name: "Suggest again" });

    api.post.mockReturnValueOnce(new Promise(() => {}));
    await userEvent.click(again);

    expect(await screen.findByRole("button", { name: /Thinking|Working/ })).toBeDisabled();
  });

});
