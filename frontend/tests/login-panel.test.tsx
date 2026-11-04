import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPanelSettings } from "@/components/admin/login-panel-settings";
import { LoginShowcase } from "@/components/auth/login-showcase";
import { ApiError, api } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/context";
import { translate } from "@/lib/i18n/core";
import {
  DEFAULT_LOGIN_IMAGE,
  emptyLoginPanel,
  emptyLoginPanelCopy,
  resolveLoginPanel,
} from "@/lib/login-panel";
import type { LoginPanel, SiteSettings } from "@/types/api";

const m = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);
const t = (key: string) => translate("en", key);
const tVi = (key: string) => translate("vi", key);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveLoginPanel", () => {
  it("falls back to the built-in text and image when nothing is customised", () => {
    const panel = resolveLoginPanel(undefined, undefined, "en", t);
    expect(panel.headline).toBe(t("auth.headline"));
    expect(panel.footer).toBe(t("auth.footerTagline"));
    expect(panel.features.map((feature) => feature.icon)).toEqual(["ask", "spaces", "control"]);
    expect(panel.image?.src).toBe(DEFAULT_LOGIN_IMAGE);
  });

  it("uses the administrator's text for that language only", () => {
    const value: LoginPanel = emptyLoginPanel();
    value.en.headline = "Ours";
    value.en.features[1] = { enabled: true, title: "Custom", description: null };

    const en = resolveLoginPanel(value, null, "en", t);
    expect(en.headline).toBe("Ours");
    expect(en.features[1].title).toBe("Custom");
    expect(en.features[1].description).toBe(t("auth.featSpacesDescription"));

    // Vietnamese was left blank, so it keeps the Vietnamese default.
    const vi = resolveLoginPanel(value, null, "vi", tVi);
    expect(vi.headline).toBe(tVi("auth.headline"));
  });

  it("drops disabled blurbs and honours the image settings", () => {
    const value = emptyLoginPanel();
    value.en.features[0].enabled = false;
    expect(resolveLoginPanel(value, null, "en", t).features).toHaveLength(2);

    expect(resolveLoginPanel(value, "/api/v1/meta/login-image?v=1", "en", t).image?.src).toBe(
      "/api/v1/meta/login-image?v=1",
    );
    value.hide_image = true;
    expect(resolveLoginPanel(value, "/x", "en", t).image).toBeNull();
  });
});

describe("LoginShowcase", () => {
  it("renders the merged copy, image and enabled blurbs", () => {
    const value = emptyLoginPanel();
    value.en.headline = "Custom headline";
    value.en.features[2].enabled = false;
    render(
      <LoginShowcase
        preview
        siteName="Acme"
        panel={resolveLoginPanel(value, "/img.png", "en", t)}
      />,
    );
    expect(screen.getByRole("heading", { name: "Custom headline" })).toBeInTheDocument();
    expect(screen.getByText(t("auth.featAskTitle"))).toBeInTheDocument();
    expect(screen.queryByText(t("auth.featControlTitle"))).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/img.png");
  });

  it("omits the illustration when it is hidden", () => {
    const value = emptyLoginPanel();
    value.hide_image = true;
    render(<LoginShowcase siteName="Acme" panel={resolveLoginPanel(value, null, "en", t)} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("LoginPanelSettings", () => {
  function Harness({
    initial = emptyLoginPanel(),
    imageUrl = null,
    onImageUrl = vi.fn(),
  }: {
    initial?: LoginPanel;
    imageUrl?: string | null;
    onImageUrl?: (url: string | null) => void;
  }) {
    const [value, setValue] = useState(initial);
    const [url, setUrl] = useState(imageUrl);
    return (
      <LocaleProvider initialLocale="en">
        <form>
          <LoginPanelSettings
            value={value}
            onChange={setValue}
            imageUrl={url}
            onImageUrlChange={(next) => {
              setUrl(next);
              onImageUrl(next);
            }}
            hasUploadedImage={url !== null}
            siteName="Acme"
            pending={false}
            dirty
          />
          <output data-testid="state">{JSON.stringify(value)}</output>
        </form>
      </LocaleProvider>
    );
  }

  const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as LoginPanel;
  const preview = () => screen.getByTestId("login-panel-preview");

  it("edits one language at a time and updates the live preview", async () => {
    const actor = userEvent.setup();
    render(<Harness />);

    await actor.type(screen.getByLabelText("Headline"), "Welcome");
    expect(state().en.headline).toBe("Welcome");
    expect(state().vi.headline).toBeNull();
    expect(within(preview()).getByText("Welcome")).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: "Tiếng Việt" }));
    expect(screen.getByLabelText("Headline")).toHaveValue("");
    expect(screen.getByLabelText("Headline")).toHaveAttribute("placeholder", tVi("auth.headline"));
    await actor.type(screen.getByLabelText("Headline"), "Xin chào");
    expect(state().vi.headline).toBe("Xin chào");
    expect(state().en.headline).toBe("Welcome");
  });

  it("empties a field back to null so the default shows again", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Footer line");
    await actor.type(field, "x");
    expect(state().en.footer).toBe("x");
    await actor.clear(field);
    expect(state().en.footer).toBeNull();
  });

  it("will not let the last enabled blurb be switched off", async () => {
    const actor = userEvent.setup();
    const initial = emptyLoginPanel();
    initial.en.features[0].enabled = false;
    initial.en.features[1].enabled = false;
    render(<Harness initial={initial} />);

    const last = screen.getByRole("switch", { name: "Blurb 3" });
    expect(last).toBeDisabled();
    await actor.click(screen.getByRole("switch", { name: "Blurb 1" }));
    expect(state().en.features[0].enabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Blurb 3" })).toBeEnabled();
  });

  it("resets only the selected language after confirmation", async () => {
    const actor = userEvent.setup();
    const initial = emptyLoginPanel();
    initial.en.headline = "EN text";
    initial.vi.headline = "VI text";
    render(<Harness initial={initial} />);

    await actor.click(screen.getByRole("button", { name: "Reset this language" }));
    await actor.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(state().en).toEqual(emptyLoginPanelCopy()));
    expect(state().vi.headline).toBe("VI text");
  });

  it("toggles the illustration off", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.click(screen.getByRole("switch", { name: "Show an illustration" }));
    expect(state().hide_image).toBe(true);
    expect(within(preview()).queryByRole("img")).not.toBeInTheDocument();
  });

  it("uploads an illustration right away and can go back to the default", async () => {
    const actor = userEvent.setup();
    const onImageUrl = vi.fn();
    const initial = emptyLoginPanel();
    initial.hide_image = true;
    mocked.post.mockResolvedValueOnce({
      effective: { login_image_url: "/api/v1/meta/login-image?v=9" },
    } as SiteSettings);
    mocked.delete.mockResolvedValueOnce({} as SiteSettings);
    render(<Harness initial={initial} onImageUrl={onImageUrl} />);

    const file = new File(["png"], "panel.png", { type: "image/png" });
    await actor.upload(screen.getByLabelText("Upload illustration"), file);

    await waitFor(() => expect(onImageUrl).toHaveBeenCalledWith("/api/v1/meta/login-image?v=9"));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/settings/login-image", undefined, {
      rawBody: expect.any(FormData),
    });
    expect(state().hide_image).toBe(false); // uploading shows it again
    expect(m.toastSuccess).toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Use the default image" }));
    await waitFor(() => expect(onImageUrl).toHaveBeenLastCalledWith(null));
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/settings/login-image");
  });

  it("rejects the wrong file type or size without calling the server", async () => {
    const actor = userEvent.setup({ applyAccept: false });
    render(<Harness />);
    const input = screen.getByLabelText("Upload illustration");

    await actor.upload(input, new File(["x"], "a.gif", { type: "image/gif" }));
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "b.png", { type: "image/png" });
    await actor.upload(input, big);

    expect(mocked.post).not.toHaveBeenCalled();
    expect(m.toastError).toHaveBeenCalledTimes(2);
  });

  it("reports a failed upload and a failed removal", async () => {
    const actor = userEvent.setup();
    mocked.post.mockRejectedValueOnce(new ApiError(415, "unsupported_media_type", "Nope."));
    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    render(<Harness imageUrl="/x" />);

    await actor.upload(
      screen.getByLabelText("Upload illustration"),
      new File(["p"], "p.png", { type: "image/png" }),
    );
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("Nope."));

    await actor.click(screen.getByRole("button", { name: "Use the default image" }));
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("Could not remove the image."));
  });
});
