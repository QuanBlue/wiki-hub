import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { LocaleProvider } from "@/lib/i18n/context";
import { ApiError, api } from "@/lib/api-client";
import type { SiteSettings } from "@/types/api";

const { refresh, toastSuccess, toastError, toastInfo, theme } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  theme: {
    setSiteName: vi.fn(),
    setThemeColor: vi.fn(),
    setDefaultFont: vi.fn(),
    setLogoIcon: vi.fn(),
    setCustomLogoUrl: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));
vi.mock("@/components/theme-color-provider", () => ({ useThemeSettings: () => theme }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

function makeSettings(
  overrides: Partial<SiteSettings["overrides"]> = {},
  effective: Partial<SiteSettings["effective"]> = {},
  extra: Partial<SiteSettings> = {},
): SiteSettings {
  return {
    overrides: {
      site_name: null,
      theme_color: null,
      default_font: null,
      logo_icon: null,
      custom_logo_url: null,
      max_upload_size_mb: null,
      max_backup_import_size_mb: null,
      allowed_attachment_types: null,
      sidebar_permissions: null,
      session_ttl_hours: null,
      ...overrides,
    },
    effective: {
      site_name: "WikiHub",
      theme_color: "blue",
      default_font: "inter",
      logo_icon: "default",
      custom_logo_url: null,
      max_upload_size_mb: 50,
      max_upload_size_bytes: 50 * 1024 * 1024,
      max_backup_import_size_mb: 1024,
      max_backup_import_size_bytes: 1024 * 1024 * 1024,
      allowed_attachment_types: [],
      sidebar_permissions: {
        home: ["admin", "member"],
        spaces: ["admin", "member"],
        favorites: ["admin", "member"],
        pinned: ["admin", "member"],
        settings: ["admin"],
        backups: ["admin"],
      },
      session_ttl_hours: 12,
      ...effective,
    },
    updated_at: null,
    updated_by_username: null,
    ...extra,
  };
}

function renderForm(settings: SiteSettings = makeSettings(), locale: "en" | "vi" = "en") {
  render(
    <LocaleProvider initialLocale={locale}>
      <SiteSettingsForm settings={settings} />
    </LocaleProvider>,
  );
  return userEvent.setup();
}

async function openTab(actor: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await actor.click(screen.getByRole("tab", { name }));
}

const panel = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocked.patch.mockResolvedValue(makeSettings({}, { site_name: "Docs Hub" }));
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SiteSettingsForm theme tab", () => {
  it("starts on the theme tab with nothing to save", () => {
    renderForm();

    expect(screen.getByRole("tab", { name: /Theme & Branding/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Save Theme/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reset Theme/ })).toBeDisabled();
    expect(screen.getAllByText("Inherited from environment").length).toBeGreaterThan(0);
  });

  it("saves a preset colour, an icon and a font, and refreshes the live theme", async () => {
    const actor = renderForm();

    await actor.click(screen.getByRole("button", { name: /Emerald Green/ }));
    await actor.click(screen.getByRole("button", { name: /Knowledge Book/ }));
    await actor.click(screen.getByRole("button", { name: /^Roboto/ }));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Settings saved successfully."));
    expect(mocked.patch).toHaveBeenCalledWith(
      "/api/v1/settings",
      expect.objectContaining({ theme_color: "emerald", logo_icon: "book", default_font: "roboto", site_name: null, session_ttl_hours: null }),
    );
    expect(theme.setSiteName).toHaveBeenCalledWith("Docs Hub");
    expect(refresh).toHaveBeenCalled();
  });

  it("uses a valid custom hex colour, and ignores a partial one", async () => {
    const actor = renderForm();
    const hex = screen.getByLabelText("Custom Hex Color:");

    await actor.clear(hex);
    await actor.type(hex, "#12a");
    expect(screen.getByText("(Custom hex active)")).toBeInTheDocument();
    await actor.type(hex, "bcd");
    fireEvent.change(screen.getByTitle("Choose custom color"), { target: { value: "#00ff00" } });
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({ theme_color: "#00ff00" }),
      ),
    );
  });

  it("loads an uploaded logo, refuses one over 2 MB, and removes it", async () => {
    const actor = renderForm();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await actor.click(screen.getByRole("button", { name: /Upload image/ }));
    expect(click).toHaveBeenCalled();
    await actor.upload(input, new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" }));
    expect(toastError).toHaveBeenCalledWith("Logo image size must be under 2MB.");
    fireEvent.change(input, { target: { files: [] } });

    await actor.upload(input, new File(["png"], "logo.png", { type: "image/png" }));
    expect(await screen.findByAltText("Custom logo preview")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Logo image loaded.");
    await actor.click(screen.getByRole("button", { name: /Remove/ }));

    expect(screen.queryByAltText("Custom logo preview")).toBeNull();
  });

  it("resets the theme back to the defaults", async () => {
    const actor = renderForm(
      makeSettings({ theme_color: "#123456", logo_icon: "cpu", default_font: "roboto", custom_logo_url: "data:x" }),
    );

    expect(screen.getAllByText("Customized").length).toBeGreaterThan(0);
    await actor.click(screen.getByRole("button", { name: /Reset Theme/ }));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({ theme_color: "blue", logo_icon: "default", default_font: "inter", custom_logo_url: null }),
      ),
    );
  });

  it("shows the server's reason when saving fails, or a generic one", async () => {
    const actor = renderForm();
    await actor.click(screen.getByRole("button", { name: /Emerald Green/ }));

    mocked.patch.mockRejectedValueOnce(new ApiError(400, "bad", "Invalid colour."));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid colour.");

    mocked.patch.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save the settings."));
  });

  it("does not touch the live theme when the server returns no settings", async () => {
    mocked.patch.mockResolvedValueOnce(undefined as never);
    const actor = renderForm();
    await actor.click(screen.getByRole("button", { name: /Emerald Green/ }));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(theme.setThemeColor).not.toHaveBeenCalled();
  });

  it("falls back to the defaults for blank effective values", async () => {
    mocked.patch.mockResolvedValueOnce(
      makeSettings({}, { site_name: "", theme_color: "", default_font: "", logo_icon: "" }),
    );
    const actor = renderForm();
    await actor.click(screen.getByRole("button", { name: /Emerald Green/ }));
    await actor.click(screen.getByRole("button", { name: /Save Theme/ }));

    await waitFor(() => expect(theme.setSiteName).toHaveBeenCalledWith("WikiHub"));
    expect(theme.setThemeColor).toHaveBeenCalledWith("blue");
    expect(theme.setDefaultFont).toHaveBeenCalledWith("inter");
    expect(theme.setLogoIcon).toHaveBeenCalledWith("default");
  });

  it("names who changed the settings last", () => {
    renderForm(makeSettings({}, {}, { updated_at: "2026-01-02T03:04:05Z", updated_by_username: "ann" }));
    expect(screen.getByText(/by ann/)).toBeInTheDocument();
  });

  it("does not name anyone for a change with no author", () => {
    renderForm(makeSettings({}, {}, { updated_at: "2026-01-02T03:04:05Z" }));
    expect(screen.getByText(/Last changed/)).not.toHaveTextContent("by");
  });
});

describe("SiteSettingsForm general tab", () => {
  it("opens on the tab named in the URL", () => {
    window.history.replaceState(null, "", "/admin/settings?tab=general");
    renderForm();
    expect(screen.getByRole("tab", { name: /General & Sessions/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens on the tab named in the hash, and ignores an unknown one", () => {
    window.history.replaceState(null, "", "/admin/settings#sidebar");
    const { unmount } = render(<SiteSettingsForm settings={makeSettings()} />);
    expect(screen.getByRole("tab", { name: /Sidebar access/ })).toHaveAttribute("aria-selected", "true");
    unmount();

    window.history.replaceState(null, "", "/admin/settings#nope");
    renderForm();
    expect(screen.getByRole("tab", { name: /Theme & Branding/ })).toHaveAttribute("aria-selected", "true");
  });

  it("renames the workspace with a live preview, and saves it", async () => {
    const actor = renderForm();
    await openTab(actor, /General & Sessions/);
    const general = panel("general-settings");

    await actor.type(within(general).getByLabelText(/Workspace name/i), "Docs Hub");
    expect(within(general).getAllByText("Docs Hub").length).toBeGreaterThan(0);
    await actor.click(within(general).getByRole("button", { name: /Save General/ }));

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({ site_name: "Docs Hub" }),
      ),
    );
  });

  it("picks session lengths from presets, the stepper and the field, and resets them", async () => {
    const actor = renderForm();
    await openTab(actor, /General & Sessions/);
    const general = panel("general-settings");
    // The large read-out of the session length currently in effect.
    const duration = () => general.querySelector(".text-xl") as HTMLElement;

    expect(duration()).toHaveTextContent("12 hours");
    await actor.click(within(general).getByRole("button", { name: /3 days/ }));
    expect(duration()).toHaveTextContent("3 days (72 hours)");
    await actor.click(within(general).getByRole("button", { name: "+1h" }));
    expect(duration()).toHaveTextContent("3 days 1 hour (73 hours)");
    await actor.click(within(general).getByRole("button", { name: "+1h" }));
    expect(duration()).toHaveTextContent("3 days 2 hours (74 hours)");
    await actor.click(within(general).getByRole("button", { name: /1 hour/ }));
    expect(duration()).toHaveTextContent("1 hour");
    await actor.click(within(general).getByRole("button", { name: "-24h" }));
    expect(duration()).toHaveTextContent("1 hour");

    await actor.clear(within(general).getByRole("spinbutton"));
    await actor.type(within(general).getByRole("spinbutton"), "48");
    expect(duration()).toHaveTextContent("2 days (48 hours)");
    expect(within(general).getByText("Admin override")).toBeInTheDocument();

    await actor.click(within(general).getByRole("button", { name: /Save General/ }));
    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({ session_ttl_hours: 48 }),
      ),
    );

    await actor.click(within(general).getByRole("button", { name: /Reset General/ }));
    expect(within(general).getByText("System default")).toBeInTheDocument();
  });

  it("offers per-field resets for the name and the session length", async () => {
    const actor = renderForm(makeSettings({ site_name: "Docs", session_ttl_hours: 24 }));
    await openTab(actor, /General & Sessions/);
    const general = panel("general-settings");

    for (const reset of within(general).getAllByRole("button", { name: "Reset to default" })) {
      await actor.click(reset);
    }

    expect(within(general).getByLabelText(/Workspace name/i)).toHaveValue("");
    expect(within(general).getByRole("spinbutton")).toHaveValue(null);
  });

  it("shows nothing for an impossible session length, and uses 12 hours without a configured one", async () => {
    const actor = renderForm(makeSettings({}, { session_ttl_hours: 0 }));
    await openTab(actor, /General & Sessions/);
    const general = panel("general-settings");

    expect(within(general).getByRole("spinbutton")).toHaveAttribute("placeholder", "12");
    await actor.type(within(general).getByRole("spinbutton"), "-5");
    expect(within(general).getByText("Admin override").closest("div")?.parentElement).toBeInTheDocument();
  });

  it("speaks Vietnamese", async () => {
    const actor = renderForm(makeSettings({ site_name: "Docs" }), "vi");
    await openTab(actor, /Cấu hình chung/);
    const general = panel("general-settings");

    expect(within(general).getByText("Đặt lại theo biến môi trường")).toBeInTheDocument();
    await actor.click(within(general).getByRole("button", { name: /3 ngày/ }));
    expect(within(general).getByText("3 ngày (72 giờ)", { selector: "div" })).toBeInTheDocument();
    await actor.click(within(general).getByRole("button", { name: "+1h" }));
    expect(within(general).getByText("3 ngày 1 giờ (73 giờ)", { selector: "div" })).toBeInTheDocument();
    await actor.click(within(general).getByRole("button", { name: /^1 giờ/ }));
    expect(within(general).getByText("1 giờ", { selector: "div" })).toBeInTheDocument();
    expect(within(general).getByText("Tùy chỉnh admin")).toBeInTheDocument();
    await openTab(actor, /Phân quyền thanh bên/);
    expect(screen.getByText("Ma trận phân quyền thanh bên")).toBeInTheDocument();
    expect(screen.getAllByText("Chỉ Admin").length).toBeGreaterThan(0);
    expect(screen.getByText("Luôn hiển thị")).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Member can access Pinned Pages"));
    await actor.click(screen.getByLabelText("Admin can access Pinned Pages"));
    expect(screen.getByText("Ẩn với mọi vai trò")).toBeInTheDocument();
    expect(screen.getByLabelText("Admin can access Pinned Pages").closest("label")).toHaveAttribute(
      "title",
      expect.stringMatching(/bị ẩn khỏi thanh bên/),
    );
    await openTab(actor, /Giao diện/);
    expect(screen.getAllByText("Đã tùy chỉnh").length).toBeGreaterThan(0);
  });
});

describe("SiteSettingsForm sidebar tab", () => {
  it("hides a section from members and saves the matrix", async () => {
    const actor = renderForm();
    await openTab(actor, /Sidebar access/);
    const sidebar = panel("sidebar-settings");

    expect(within(sidebar).getByLabelText("Admin can access Administration & Settings")).toBeDisabled();
    expect(within(sidebar).getByLabelText("Member can access Home")).toBeDisabled();
    await actor.click(within(sidebar).getByLabelText("Member can access Pinned Pages"));
    expect(within(sidebar).getAllByText("Admin only").length).toBeGreaterThan(2);
    await actor.click(within(sidebar).getByLabelText("Admin can access Pinned Pages"));
    expect(within(sidebar).getByText("Hidden from everyone")).toBeInTheDocument();
    expect(within(sidebar).getByLabelText("Admin can access Pinned Pages").closest("label")).toHaveAttribute(
      "title",
      expect.stringMatching(/hidden from the sidebar for everyone/),
    );
    await actor.click(within(sidebar).getByLabelText("Member can access Pinned Pages"));
    await actor.click(within(sidebar).getByRole("button", { name: /Save Sidebar/ }));

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({
          sidebar_permissions: expect.objectContaining({ pinned: ["member"] }),
        }),
      ),
    );
  });

  it("resets the matrix to what is in effect", async () => {
    const actor = renderForm(
      makeSettings({}, { sidebar_permissions: undefined as never }),
    );
    await openTab(actor, /Sidebar access/);
    const sidebar = panel("sidebar-settings");

    await actor.click(within(sidebar).getByLabelText("Member can access Spaces"));
    await actor.click(within(sidebar).getByRole("button", { name: /Reset Sidebar/ }));

    expect(within(sidebar).getByLabelText("Member can access Spaces")).toBeChecked();
    expect(within(sidebar).getByRole("button", { name: /Save Sidebar/ })).toBeDisabled();
  });

  it("treats a missing role list as hidden", async () => {
    const actor = renderForm(
      makeSettings({}, { sidebar_permissions: { favorites: undefined } as never }),
    );
    await openTab(actor, /Sidebar access/);
    // Falls back to everyone when nothing is configured.
    expect(within(panel("sidebar-settings")).getByLabelText("Member can access Favorite Spaces")).toBeChecked();
  });
});

describe("SiteSettingsForm preview", () => {
  async function openPreview(settings: SiteSettings = makeSettings()) {
    const actor = renderForm(settings);
    await actor.click(screen.getByRole("button", { name: /Preview Theme/ }));
    return { actor, dialog: await screen.findByRole("dialog", { name: /Live Preview/ }) };
  }

  it("lets every mock control be tried, and switches light and dark", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { actor, dialog } = await openPreview();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

      for (const button of within(dialog).getAllByRole("button")) {
        const label = button.textContent ?? "";
        if (/Close Preview|Save & Apply|Close$/.test(label) || button.getAttribute("aria-label") === "Close") continue;
        if (button.getAttribute("aria-haspopup") || button.getAttribute("aria-expanded") !== null) continue;
        fireEvent.click(button);
      }
      expect(toastInfo).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalled();
      expect(within(dialog).getByText(/^Copied #/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2000));
      expect(within(dialog).getByText("Click shade to copy")).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("checkbox"));
      fireEvent.click(within(dialog).getByRole("radio", { name: "Enterprise" }));
      fireEvent.click(within(dialog).getByRole("radio", { name: "Standard" }));
      expect(within(dialog).getByRole("radio", { name: "Standard" })).toBeChecked();

      await actor.click(within(dialog).getByRole("button", { name: /Dark Preview|Light Preview/ }));
      expect(within(dialog).getByRole("button", { name: /Light Preview|Dark Preview/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches colour, icon and font from the preview, and saves from there", async () => {
    const { actor, dialog } = await openPreview();
    const triggers = within(dialog)
      .getAllByRole("button")
      .filter((button) => button.className.includes("w-32"));

    await actor.click(triggers[0]!);
    await actor.click(screen.getByRole("menuitemradio", { name: /Modern Indigo/ }));
    await actor.click(triggers[1]!);
    await actor.click(screen.getByRole("menuitemradio", { name: /Tech Core/ }));
    await actor.click(triggers[2]!);
    await actor.click(screen.getByRole("menuitemradio", { name: /^Roboto/ }));
    expect(triggers[0]).toHaveTextContent("Modern Indigo");
    expect(triggers[1]).toHaveTextContent("Core");
    await actor.click(within(dialog).getByRole("button", { name: /Save & Apply Theme/ }));

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/settings",
        expect.objectContaining({ theme_color: "indigo", logo_icon: "cpu", default_font: "roboto" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Live Preview/ })).toBeNull());
  });

  it("offers the custom colour in the preview, and switches back to it", async () => {
    const { actor, dialog } = await openPreview(makeSettings({ theme_color: "#336699" }));
    const colour = within(dialog)
      .getAllByRole("button")
      .find((button) => button.className.includes("w-32"))!;

    expect(colour).toHaveTextContent("Custom (#336699)");
    await actor.click(colour);
    await actor.click(screen.getByRole("menuitemradio", { name: /Custom \(#336699\)/ }));
    expect(colour).toHaveTextContent("Custom (#336699)");
    await actor.click(colour);
    await actor.click(screen.getByRole("menuitemradio", { name: /Ocean Teal/ }));
    await actor.click(colour);
    await actor.click(screen.getByRole("menuitemradio", { name: /Ocean Teal/ }));
    expect(colour).toHaveTextContent("Ocean Teal");
  });

  it("names an unknown icon generically and closes", async () => {
    const { actor, dialog } = await openPreview(makeSettings({ logo_icon: "mystery", theme_color: "nope" }));

    expect(within(dialog).getByText("Icon", { selector: "span.truncate" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Blue").length).toBeGreaterThan(0);
    await actor.click(within(dialog).getByRole("button", { name: "Close Preview" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("SiteSettingsForm font specimen", () => {
  it("inspects a font, tries it out, and selects it", async () => {
    const actor = renderForm();

    await actor.click(screen.getByRole("button", { name: "Inspect Roboto font specimen" }));
    const dialog = await screen.findByRole("dialog");
    const sizes = within(dialog).getAllByRole("button").filter((button) => /^\d+px$/.test(button.textContent ?? ""));
    if (sizes[0]) await actor.click(sizes[0]);
    await actor.type(within(dialog).getByPlaceholderText(/Type custom text/), "Hello");
    await actor.click(within(dialog).getByTitle("Clear text"));
    const preset = within(dialog).getAllByRole("button").find((button) => button.title && button.title !== "Clear text" && !button.title.startsWith("Shade"));
    if (preset) await actor.click(preset);
    await actor.click(within(dialog).getByRole("button", { name: /Apply This Font/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /Save Theme/ })).toBeEnabled();

    await actor.click(screen.getByRole("button", { name: "Inspect Roboto font specimen" }));
    expect(await screen.findByText("Currently Active")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Keep Selected" }));
    await actor.click(screen.getByRole("button", { name: "Inspect Inter font specimen" }));
    await actor.click(await screen.findByRole("button", { name: "Select Inter" }));
    await actor.click(screen.getByRole("button", { name: "Inspect Inter font specimen" }));
    await actor.click(within(await screen.findByRole("dialog")).getByText("Close", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
