import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SeasonalThemeSettingsPanel } from "@/components/admin/seasonal-theme-settings";
import { ThemeColorProvider } from "@/components/theme-color-provider";
import {
  SeasonalLoginAtmosphere,
  SeasonalLoginCardEdge,
  SeasonalLoginGreeting,
  SeasonalLoginWatermark,
  SeasonalShowcaseFoot,
} from "@/components/seasonal/seasonal-login-decor";
import { SeasonalPreviewMock } from "@/components/seasonal/seasonal-preview-mock";
import { LocaleProvider } from "@/lib/i18n/context";
import type { SeasonalEffectPresetId, SeasonalThemeSettings } from "@/types/api";

function withLocale(ui: React.ReactNode) {
  return render(<LocaleProvider initialLocale="en">{ui}</LocaleProvider>);
}

function LoginDecor({ preset }: { preset: SeasonalEffectPresetId }) {
  return (
    <>
      <SeasonalLoginAtmosphere preset={preset} contained />
      <SeasonalLoginCardEdge preset={preset} />
      <SeasonalShowcaseFoot preset={preset} />
      <SeasonalLoginGreeting preset={preset} />
      <SeasonalLoginWatermark preset={preset} />
    </>
  );
}

describe("SeasonalPreviewMock", () => {
  it("draws the Home page with the pack's rail, particles and greeting", () => {
    const { container } = withLocale(<SeasonalPreviewMock preset="lunar_new_year" />);

    expect(screen.getByRole("tab", { name: "In the app" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const frame = screen.getByTestId("seasonal-preview-frame");
    // Rail overlay, the selected nav row and particles kept inside the frame.
    expect(frame.querySelector("[data-wh-rail]")).not.toBeNull();
    expect(frame.querySelector('[aria-current="page"]')).not.toBeNull();
    const particles = frame.querySelectorAll(".wh-seasonal-fall");
    expect(particles.length).toBeGreaterThan(0);
    expect(particles[0].closest(".fixed")).toBeNull();
    // Nothing in the picture is interactive.
    expect(frame.querySelector("[inert]")).not.toBeNull();
    expect(container.querySelector('[data-testid="seasonal-login-edge"]')).toBeNull();
  });

  it("plays the festival's welcome effect over the mock Home and replays it on demand", async () => {
    const user = userEvent.setup();
    const { container } = withLocale(<SeasonalPreviewMock preset="valentine" />);
    const frame = screen.getByTestId("seasonal-preview-frame");

    // Autoplays on open, inside the frame, with the festive greeting and no Skip button.
    expect(frame.querySelector('[role="status"]')).not.toBeNull();
    expect(
      within(frame.querySelector('[role="status"]') as HTMLElement).getByText(/Happy Valentine/),
    ).toBeInTheDocument();
    expect(within(frame).queryByRole("button", { name: /skip/i })).toBeNull();

    // The sign-in tab hides it; the replay button brings it back on the Home tab.
    await user.click(screen.getByRole("tab", { name: "Sign-in page" }));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Play welcome effect" }));
    expect(
      screen.getByTestId("seasonal-preview-frame").querySelector('[role="status"]'),
    ).not.toBeNull();
  });

  it("offers no replay button for a pack without a welcome scene", () => {
    withLocale(<SeasonalPreviewMock preset="none" />);
    expect(screen.queryByRole("button", { name: "Play welcome effect" })).toBeNull();
  });

  it("switches to the sign-in page with its seasonal pieces", async () => {
    const user = userEvent.setup();
    withLocale(<SeasonalPreviewMock preset="christmas" />);

    await user.click(screen.getByRole("tab", { name: "Sign-in page" }));

    expect(screen.getByRole("tab", { name: "Sign-in page" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const frame = screen.getByTestId("seasonal-preview-frame");
    expect(frame.querySelector('[data-testid="seasonal-login-edge"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="seasonal-login-foot"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="seasonal-login-greeting"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="seasonal-login-watermark"] pattern')).not.toBeNull();
    expect(frame.querySelector("[data-wh-rail]")).toBeNull();
  });

  it("shows the badge it is given", () => {
    withLocale(<SeasonalPreviewMock preset="halloween" badge={<span>Preview</span>} />);
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
});

describe("sign-in page decoration", () => {
  it("renders nothing when no pack is active", () => {
    const { container } = withLocale(<LoginDecor preset="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every piece for an active pack", () => {
    const { container } = withLocale(<LoginDecor preset="lunar_new_year" />);
    expect(screen.getByTestId("seasonal-login-wash")).toBeInTheDocument();
    expect(screen.getByTestId("seasonal-login-edge")).toBeInTheDocument();
    expect(screen.getByTestId("seasonal-login-foot")).toBeInTheDocument();
    expect(screen.getByTestId("seasonal-login-greeting").textContent).not.toBe("");
    expect(
      screen.getByTestId("seasonal-login-watermark").querySelector("pattern"),
    ).not.toBeNull();
    expect(container.querySelectorAll(".wh-seasonal-fall").length).toBeGreaterThan(0);
  });

  it("keeps the solemn memorial pack still: no particles", () => {
    const { container } = withLocale(<LoginDecor preset="memorial_candle" />);
    expect(screen.getByTestId("seasonal-login-edge")).toBeInTheDocument();
    expect(screen.getByTestId("seasonal-login-watermark")).toBeInTheDocument();
    expect(
      container.querySelectorAll(
        ".wh-seasonal-fall, .wh-seasonal-rise, .wh-seasonal-float, .wh-seasonal-tile-drift, .wh-seasonal-tile-drift-y",
      ),
    ).toHaveLength(0);
  });
});

describe("SeasonalThemeSettingsPanel preview modal", () => {
  const settings: SeasonalThemeSettings = {
    mode: "manual",
    manual_preset: "halloween",
    events: [],
  } as unknown as SeasonalThemeSettings;

  function renderPanel() {
    return withLocale(
      <ThemeColorProvider>
        <SeasonalThemeSettingsPanel
          value={settings}
          onChange={() => {}}
          onResetDefaults={() => {}}
          pending={false}
        />
      </ThemeColorProvider>,
    );
  }

  it("shows no preview card until Preview is clicked, then opens it in a modal", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByTestId("seasonal-preview-frame")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Preview: Halloween/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("seasonal-preview-frame")).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Sign-in page" })).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByTestId("seasonal-preview-frame")).toBeNull();
  });
});
