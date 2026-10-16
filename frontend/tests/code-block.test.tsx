import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CodeBlock } from "@/components/issues/code-block";

describe("CodeBlock", () => {
  it("copies the code and says so, then goes back to offering Copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<CodeBlock code="ls -la" language="bash" />);

    await actor.click(screen.getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("ls -la");
    expect(await screen.findByText("Copied")).toBeInTheDocument();

    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not claim to have copied when the browser refuses", async () => {
    const actor = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    render(<CodeBlock code="ls" language="" />);

    await actor.click(screen.getByRole("button", { name: /Copy/ }));

    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });
});
