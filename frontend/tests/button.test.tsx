import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button disabled affordance", () => {
  it("shows the not-allowed cursor on a disabled button", () => {
    // Regression: the base classes paired `disabled:pointer-events-none` with
    // `disabled:cursor-not-allowed`. Removing the element from hit-testing
    // means the browser never resolves a cursor for it, so the second rule was
    // dead and a disabled button looked identical to hover.
    render(<Button disabled>Upload and scan</Button>);
    const button = screen.getByRole("button", { name: /upload and scan/i });

    expect(button.className).toContain("disabled:cursor-not-allowed");
    expect(button.className).not.toContain("disabled:pointer-events-none");
  });

  it("does not apply hover styling to a disabled button", () => {
    // Pointer events being back means `:hover` can now match a disabled
    // button, so every hover rule has to exclude that state or a dead control
    // lights up under the pointer as though it still worked.
    render(
      <Button disabled variant="primary">
        Restore backup
      </Button>,
    );
    const button = screen.getByRole("button", { name: /restore backup/i });

    for (const cls of button.className.split(/\s+/)) {
      if (cls.includes("hover:")) {
        expect(cls).toContain(":not(:disabled)");
      }
    }
  });

  it("keeps blocking pointer events when rendered as something else", () => {
    // `asChild` renders an anchor, where the `disabled` attribute is inert -
    // there, killing pointer events is the only thing stopping the click.
    render(
      <Button asChild disabled>
        <a href="/somewhere">Download</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: /download/i });

    expect(link.className).toContain("disabled:pointer-events-none");
  });

  it("still gives an enabled button its hover styling", () => {
    render(<Button variant="primary">Export</Button>);
    const button = screen.getByRole("button", { name: /export/i });

    expect(button.className).toContain(
      "[&:not(:disabled)]:hover:bg-primary-hover",
    );
  });
});
