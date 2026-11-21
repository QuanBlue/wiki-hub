import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WelcomePopoverBadge, EFFECT_BADGE } from "@/components/users/welcome-effect-badge";
import { createWelcomeRenderer } from "@/components/users/welcome-effect-overlay";
import { LocaleProvider } from "@/lib/i18n/context";
import type { PlayableWelcomeEffect, WelcomeEffect } from "@/types/api";

describe("popover badge table", () => {
  it("covers exactly the effects the overlay can play", () => {
    const keys = Object.keys(EFFECT_BADGE);
    expect(keys.length).toBeGreaterThanOrEqual(40);
    for (const key of keys) {
      expect(createWelcomeRenderer(key as PlayableWelcomeEffect, 400, 300), key).not.toBeNull();
    }
  });

  it("names the member's effect, and renders nothing for none or an unknown one", () => {
    const { container, rerender } = render(<WelcomePopoverBadge effect={"hacker" as WelcomeEffect} />, {
      wrapper: LocaleProvider,
    });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toBe("");
    rerender(<WelcomePopoverBadge effect={"" as WelcomeEffect} />);
    expect(container.textContent).toBe("");
    rerender(<WelcomePopoverBadge effect={"nope" as WelcomeEffect} />);
    expect(screen.queryByText(/./)).toBeNull();
  });
});
