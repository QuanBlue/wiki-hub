import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/account/profile-form";
import { ProfileSummary } from "@/components/account/profile-summary";
import { ApiError, api } from "@/lib/api-client";
import type { Me } from "@/types/api";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("@/components/account/image-crop-dialog", () => ({
  ImageCropDialog: ({ file, onApply, onClose }: {
    file: File;
    onApply: (file: File, crop: { zoom: number; x: number; y: number }) => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Position image">
      <button type="button" onClick={() => onApply(file, { zoom: 2, x: 0.1, y: 0.2 })}>Use image</button>
      <button type="button" onClick={onClose}>Cancel positioning</button>
    </div>
  ),
}));
vi.mock("@/components/users/welcome-effect-dialog", () => ({
  WelcomeEffectDialog: ({
    open,
    onSaved,
    onOpenChange,
  }: {
    open: boolean;
    onSaved: (effect: string, message: string) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Welcome effect dialog">
        <label htmlFor="custom-greeting">Custom greeting (optional)</label>
        <input id="custom-greeting" defaultValue="Hello" />
        <button type="button" onClick={() => onSaved("phoenix", "Hello")}>
          Save welcome
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close welcome
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/account/status-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/account/status-dialog")>();
  return {
    ...actual,
    UserStatusDialog: ({
      open,
      onUpdated,
    }: {
      open: boolean;
      onUpdated: (u: Record<string, unknown>) => void;
    }) =>
      open ? (
        <div role="dialog" aria-label="Status dialog">
          <button
            type="button"
            onClick={() => onUpdated({ status_emoji: "🔥", status_text: "Busy", status_expires_at: null })}
          >
            Save status
          </button>
        </div>
      ) : null,
  };
});
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

function me(overrides: Partial<Me> = {}): Me {
  return {
    username: "ann",
    full_name: "Ann Lee",
    email: "ann@example.com",
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
    avatar_url: null,
    is_superuser: false,
    is_protected: false,
    ...overrides,
  } as Me;
}

const png = (name = "a.png", size = 10) => {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocked.patch.mockResolvedValue({});
  mocked.post.mockResolvedValue({});
  mocked.delete.mockResolvedValue({});
});

function renderForm(user: Me = me(), props: Partial<React.ComponentProps<typeof ProfileForm>> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const onWelcomeSaved = vi.fn();
  render(<ProfileForm user={user} onCancel={onCancel} onSaved={onSaved} onWelcomeSaved={onWelcomeSaved} {...props} />);
  return { onSaved, onCancel, onWelcomeSaved };
}

const save = () => screen.getByRole("button", { name: "Save changes" });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]:not([aria-label])')!;
const coverInput = () => screen.getByLabelText("Profile cover") as HTMLInputElement;

describe("ProfileForm", () => {
  it("lets a member with the welcome permission change their welcome effect", async () => {
    const actor = userEvent.setup();
    const { onWelcomeSaved } = renderForm(me({ global_permissions: ["customize_profile_welcome"], welcome_effect: "tet" }));
    expect(screen.getByText("Lunar New Year")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Welcome effect" }));
    expect(await screen.findByLabelText("Custom greeting (optional)")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Save welcome" }));
    expect(onWelcomeSaved).toHaveBeenCalledWith("phoenix", "Hello");
  });

  it("hides the welcome effect row without the permission", () => {
    renderForm(me());
    expect(screen.queryByRole("button", { name: "Welcome effect" })).not.toBeInTheDocument();
  });

  it("saves trimmed values and shows success", async () => {
    const actor = userEvent.setup();
    const { onSaved } = renderForm(me({ social_links: ["https://a.example"], pronouns: "they/them" }));
    const name = screen.getByLabelText("Display name");
    await actor.clear(name);
    await actor.type(name, "  Ann Q  ");
    await actor.type(screen.getByLabelText("Bio"), " hi ");
    await actor.type(screen.getByLabelText("Company or team"), " Acme ");
    await actor.type(screen.getByLabelText("Website"), "https://ann.example");
    await actor.type(screen.getByLabelText("Social link 2"), "https://b.example");
    await actor.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/me", {
      full_name: "Ann Q",
      email: "ann@example.com",
      bio: "hi",
      pronouns: "they/them",
      profile_url: "https://ann.example",
      social_links: ["https://a.example", "https://b.example"],
      company: "Acme",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Profile updated.");
    expect(refresh).toHaveBeenCalled();
  });

  it("sends an empty pronoun and website when left unspecified", async () => {
    renderForm();
    await userEvent.click(save());
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    expect(mocked.patch.mock.calls[0][1]).toMatchObject({ pronouns: "", profile_url: null, social_links: [] });
  });

  it("picks pronouns from the list", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.click(screen.getByRole("button", { name: "Pronouns" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "She/her" }));
    await actor.click(save());
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    expect(mocked.patch.mock.calls[0][1]).toMatchObject({ pronouns: "she/her" });
  });

  it("validates every field and does not submit", async () => {
    const actor = userEvent.setup();
    renderForm(me({ full_name: "", email: "x" }));
    await actor.type(screen.getByLabelText("Bio"), "b");
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "b".repeat(501) } });
    fireEvent.change(screen.getByLabelText("Company or team"), { target: { value: "c".repeat(256) } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "ftp://x.example" } });
    fireEvent.change(screen.getByLabelText("Social link 1"), { target: { value: "not a url" } });
    await actor.click(save());

    expect(screen.getByText("Enter a display name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Bio must be 500 characters or fewer.")).toBeInTheDocument();
    expect(screen.getByText("Company or team must be 255 characters or fewer.")).toBeInTheDocument();
    expect(screen.getByText("Website must start with http:// or https://.")).toBeInTheDocument();
    expect(screen.getByText("Social link 1 must be a valid URL.")).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it("flags a too-long name and a missing email, and clears an error once fixed", async () => {
    const actor = userEvent.setup();
    renderForm(me({ email: "" }));
    expect(save()).toBeDisabled();
    const name = screen.getByLabelText("Display name");
    fireEvent.change(name, { target: { value: "n".repeat(300) } });
    fireEvent.blur(name);
    expect(screen.getByText("Display name must be 255 characters or fewer.")).toBeInTheDocument();
    await actor.clear(name);
    await actor.type(name, "Ann");
    fireEvent.blur(name);
    expect(screen.queryByText("Display name must be 255 characters or fewer.")).not.toBeInTheDocument();

    const email = screen.getByLabelText("Email address");
    fireEvent.change(email, { target: { value: "  " } });
    fireEvent.blur(email);
    expect(screen.getByText("Enter an email address.")).toBeInTheDocument();
  });

  it("validates fields on blur", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "b".repeat(501) } });
    fireEvent.blur(screen.getByLabelText("Bio"));
    fireEvent.change(screen.getByLabelText("Company or team"), { target: { value: "c".repeat(256) } });
    fireEvent.blur(screen.getByLabelText("Company or team"));
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "nope" } });
    fireEvent.blur(screen.getByLabelText("Website"));
    fireEvent.change(screen.getByLabelText("Social link 2"), { target: { value: "nope" } });
    fireEvent.blur(screen.getByLabelText("Social link 2"));
    expect(screen.getByText("Website must be a valid URL.")).toBeInTheDocument();
    expect(screen.getByText("Social link 2 must be a valid URL.")).toBeInTheDocument();
  });

  it("uploads a chosen picture after saving the profile", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.upload(fileInput(), png());
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:preview");
    await actor.click(save());
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][0]).toBe("/api/v1/users/me/avatar");
    expect(mocked.post.mock.calls[0][2]).toMatchObject({ rawBody: expect.any(FormData) });
  });

  it("previews and uploads a profile cover", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.upload(coverInput(), png("cover.png"));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    expect(document.querySelector('img[src="blob:preview"]')).toBeInTheDocument();
    await actor.click(save());
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][0]).toBe("/api/v1/users/me/cover");
    expect(mocked.post.mock.calls[0][2]).toMatchObject({ rawBody: expect.any(FormData) });
  });

  it("removes an existing profile cover", async () => {
    const actor = userEvent.setup();
    renderForm(me({ cover_url: "/cover.png" }));
    expect(document.querySelector('img[src="/cover.png"]')).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Remove profile cover" }));
    await actor.click(save());
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/me/cover"));
  });

  it("rejects oversized profile covers", () => {
    renderForm();
    fireEvent.change(coverInput(), { target: { files: [png("big.png", 11 * 1024 * 1024)] } });
    expect(screen.getByText("Profile covers must be 10 MB or smaller.")).toBeInTheDocument();
  });

  it("replaces a previous preview and revokes the old one", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.upload(fileInput(), png("one.png"));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    await actor.upload(fileInput(), png("two.png"));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("rejects the wrong type or size, and ignores an empty choice", async () => {
    renderForm();
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("Choose a JPEG, PNG, GIF, or WebP image.")).toBeInTheDocument();
    fireEvent.change(fileInput(), { target: { files: [png("big.png", 6 * 1024 * 1024)] } });
    expect(await screen.findByText("Profile pictures must be 5 MB or smaller.")).toBeInTheDocument();
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("removes the current picture on save", async () => {
    const actor = userEvent.setup();
    renderForm(me({ avatar_url: "/me.png" }));
    expect(document.querySelector("img")).toHaveAttribute("src", "/me.png");
    await actor.click(screen.getByRole("button", { name: "Remove" }));
    expect(document.querySelector("img")).toBeNull();
    await actor.click(save());
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/me/avatar"));
  });

  it("removes a freshly chosen preview without touching the saved picture", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.upload(fileInput(), png());
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("shows the server's error and lets the user try again", async () => {
    mocked.patch.mockRejectedValueOnce(new ApiError(409, "dup", "Email taken."));
    const actor = userEvent.setup();
    renderForm();
    await actor.click(save());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("cancels", async () => {
    const { onCancel } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("resets unsaved edits when Reset is clicked", async () => {
    const actor = userEvent.setup();
    renderForm();
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();

    const name = screen.getByLabelText("Display name");
    await actor.clear(name);
    await actor.type(name, "Changed Name");
    expect(reset).toBeEnabled();

    await actor.click(reset);
    expect(name).toHaveValue("Ann Lee");
    expect(reset).toBeDisabled();
  });

  it("falls back to initials, then an icon, when there is no picture", () => {
    renderForm(me({ full_name: "", username: "bob" }));
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("opens the file picker from the Change button", async () => {
    renderForm();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(click).toHaveBeenCalled();
  });

  it("keeps the previous picture when positioning is cancelled", async () => {
    const actor = userEvent.setup();
    renderForm(me({ avatar_url: "/me.png" }));
    await actor.upload(fileInput(), png());
    await actor.click(screen.getByRole("button", { name: "Cancel positioning" }));
    expect(document.querySelector('img[src="/me.png"]')).toBeInTheDocument();
    await actor.click(save());
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

describe("ProfileSummary", () => {
  it("opens the full cover and avatar from their profile images", async () => {
    const actor = userEvent.setup();
    render(<ProfileSummary user={me({
      avatar_url: "/me.png",
      cover_url: "/cover.png",
      cover_updated_at: "2026-11-04T12:00:00Z",
    })} onEdit={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "View profile cover" }));
    const coverDialog = screen.getByRole("dialog", { name: "Profile cover" });
    expect(within(coverDialog).getByText("Image information")).toBeInTheDocument();
    expect(within(coverDialog).getByText("Ann Lee")).toBeInTheDocument();
    expect(within(coverDialog).getByText("Last updated")).toBeInTheDocument();
    expect(within(coverDialog).getByText(/2026/)).toBeInTheDocument();
    const coverImage = within(coverDialog).getByRole("img", { name: "Profile cover" });
    expect(coverImage).toHaveAttribute("src", "/cover.png");
    Object.defineProperties(coverImage, {
      naturalWidth: { configurable: true, value: 1500 },
      naturalHeight: { configurable: true, value: 400 },
    });
    fireEvent.load(coverImage);
    expect(within(coverDialog).getByText("1500 × 400 px")).toBeInTheDocument();
    await actor.keyboard("{Escape}");

    await actor.click(screen.getByRole("button", { name: "View profile picture" }));
    const avatarDialog = screen.getByRole("dialog", { name: "Profile picture" });
    expect(within(avatarDialog).getByText("@ann")).toBeInTheDocument();
    expect(within(avatarDialog).getByText("Not recorded")).toBeInTheDocument();
    expect(within(avatarDialog).getByRole("img", { name: "Profile picture" })).toHaveAttribute("src", "/me.png");
  });

  it("downloads the viewed GIF avatar with a .gif filename", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["GIF89a"], { type: "image/gif" }), {
      headers: { "Content-Type": "image/gif" },
    })));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ProfileSummary user={me({
      avatar_url: "/me.gif",
      avatar_content_type: "image/gif",
      avatar_crop: { zoom: 1.5, x: 0.1, y: 0 },
    })} onEdit={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "View profile picture" }));
    const avatarDialog = screen.getByRole("dialog", { name: "Profile picture" });
    await actor.click(within(avatarDialog).getByRole("button", { name: "Download" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/me.gif", { credentials: "same-origin" });
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("shows the essentials for a bare member", () => {
    const onEdit = vi.fn();
    render(<ProfileSummary user={me()} onEdit={onEdit} />);
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change profile cover" })).not.toBeInTheDocument();
    expect(screen.queryByText("Social links")).not.toBeInTheDocument();
  });

  it("shows everything for a full profile", async () => {
    const onEdit = vi.fn();
    render(
      <ProfileSummary
        user={me({
          bio: "About me",
          pronouns: "she/her",
          company: "Acme",
          profile_url: "ann.example",
          social_links: ["https://a.example", "b.example"],
          is_superuser: true,
          is_protected: true,
          avatar_url: "/me.png",
          cover_url: "/cover.png",
        } as Partial<Me>)}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("About me")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(document.querySelector('img[src="/cover.png"]')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ann.example" })).toHaveAttribute("href", "https://ann.example");
    expect(screen.getByRole("link", { name: "https://a.example" })).toHaveAttribute("href", "https://a.example");
    await userEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("handles a profile with only some optional parts", () => {
    const first = render(<ProfileSummary user={me({ pronouns: "he/him" })} onEdit={vi.fn()} />);
    expect(screen.getByText("he/him")).toBeInTheDocument();
    first.unmount();
    const second = render(<ProfileSummary user={me({ social_links: ["https://a.example"] })} onEdit={vi.fn()} />);
    expect(screen.getByText("Social links")).toBeInTheDocument();
    second.unmount();
    render(<ProfileSummary user={me({ profile_url: "https://site.example", company: "Acme" })} onEdit={vi.fn()} />);
    expect(screen.queryByText("Social links")).not.toBeInTheDocument();
  });

  it("opens status dialog on bubble click", async () => {
    const actor = userEvent.setup();
    render(<ProfileSummary user={me({ status_emoji: "🚀", status_text: "Coding" })} onEdit={vi.fn()} />);
    const bubble = screen.getByRole("button", { name: "Update status" });
    await actor.click(bubble);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Save status" }));
  });
});

describe("ProfileForm reposition", () => {
  it("offers Upload and Reposition on a picture and saves a new crop without re-uploading the original", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))));
    renderForm(me({ avatar_url: "/me.png", avatar_has_original: true, avatar_crop: { zoom: 1, x: 0, y: 0 } }));

    await actor.click(screen.getAllByRole("button", { name: "Picture options" })[0]);
    expect(await screen.findByRole("menuitem", { name: "Upload new picture" })).toBeInTheDocument();
    await actor.click(screen.getByRole("menuitem", { name: "Reposition" }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/users/me/avatar/original", expect.anything());

    await actor.click(await screen.findByRole("button", { name: "Use image" }));
    await actor.click(save());
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    const body = mocked.post.mock.calls[0][2]!.rawBody as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("original")).toBeNull();
    expect(JSON.parse(body.get("crop") as string)).toEqual({ zoom: 2, x: 0.1, y: 0.2 });
    vi.unstubAllGlobals();
  });

  it("shows direct Reposition buttons beside Change/Remove for cover and avatar and signals cover change to onSaved", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))));
    const { onSaved } = renderForm(
      me({
        avatar_url: "/me.png",
        cover_url: "/cover.png",
        avatar_has_original: true,
        cover_has_original: true,
        avatar_crop: { zoom: 1, x: 0, y: 0 },
        cover_crop: { zoom: 1, x: 0, y: 0 },
      }),
    );

    const repositionButtons = screen.getAllByRole("button", { name: "Reposition" });
    expect(repositionButtons).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();

    // Clicking direct Reposition on cover fetches original cover without cache-busting query params.
    await actor.click(repositionButtons[0]!);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/users/me/cover/original",
      expect.objectContaining({ cache: "no-store" }),
    );
    await actor.click(await screen.findByRole("button", { name: "Use image" }));
    await actor.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.anything(), false, true));
    vi.unstubAllGlobals();
  });

  it("positions an animated GIF avatar in the crop dialog and uploads the GIF with crop metadata", async () => {
    const actor = userEvent.setup();
    const gif = new File(["GIF89a"], "wave.gif", { type: "image/gif" });
    const { onSaved } = renderForm();

    await actor.upload(fileInput(), gif);
    expect(screen.getByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));

    expect(screen.getByRole("button", { name: "Reposition" })).toBeInTheDocument();
    await actor.click(save());
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    const body = mocked.post.mock.calls[0][2]!.rawBody as FormData;
    const uploaded = body.get("file") as File;
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.type).toBe("image/gif");
    expect(uploaded.name).toBe("wave.gif");
    expect(body.get("original")).toBeNull();
    expect(JSON.parse(body.get("crop") as string)).toEqual({ zoom: 2, x: 0.1, y: 0.2 });
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), true, false);
  });

  it("allows repositioning a saved GIF avatar from its current image", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["GIF89a"], { type: "image/gif" }))));
    renderForm(me({
      avatar_url: "/me.gif",
      avatar_content_type: "image/gif",
      avatar_crop: { zoom: 1.5, x: 0.1, y: -0.1 },
    }));

    await actor.click(screen.getByRole("button", { name: "Reposition" }));
    expect(fetch).toHaveBeenCalledWith("/me.gif", expect.objectContaining({ cache: "no-store" }));
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    await actor.click(save());

    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    const body = mocked.post.mock.calls[0][2]!.rawBody as FormData;
    expect((body.get("file") as File).type).toBe("image/gif");
    expect(body.get("original")).toBeNull();
    expect(JSON.parse(body.get("crop") as string)).toEqual({ zoom: 2, x: 0.1, y: 0.2 });
    vi.unstubAllGlobals();
  });

  it("shows an error when reposition fetch fails", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderForm(me({ avatar_url: "/me.png", avatar_has_original: true, avatar_crop: { zoom: 1, x: 0, y: 0 } }));

    await actor.click(screen.getByRole("button", { name: "Reposition" }));
    expect(await screen.findByText(/Could not open the current picture to reposition it/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("refuses an invalid cover image type", () => {
    renderForm(me());
    fireEvent.change(coverInput(), { target: { files: [new File(["text"], "file.txt", { type: "text/plain" })] } });
    expect(screen.getByText("Choose a JPEG, PNG, GIF, or WebP image.")).toBeInTheDocument();
  });

  it("repositions a pending cover file", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))));
    renderForm(me());
    await actor.upload(coverInput(), new File(["gif"], "cover.gif", { type: "image/gif" }));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    const repositionButtons = screen.getAllByRole("button", { name: "Reposition" });
    await actor.click(repositionButtons[0]!);
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    vi.unstubAllGlobals();
  });

  it("allows repositioning a saved cover without server original using fallback content type", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["data"], { type: "" }))));
    renderForm(me({
      cover_url: "/cover.jpg",
      cover_has_original: false,
      cover_content_type: "image/jpeg",
      cover_crop: { zoom: 1, x: 0, y: 0 },
    }));

    await actor.click(screen.getByRole("button", { name: "Reposition" }));
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    vi.unstubAllGlobals();
  });

  it("positions a newly chosen GIF avatar before saving", async () => {
    const actor = userEvent.setup();
    renderForm(me());
    await actor.upload(fileInput(), new File(["GIF89a"], "avatar.gif", { type: "image/gif" }));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    const repositionButtons = screen.getAllByRole("button", { name: "Reposition" });
    await actor.click(repositionButtons[repositionButtons.length - 1]!);
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
  });

  it("repositions a pending PNG avatar using its kept original before saving", async () => {
    const actor = userEvent.setup();
    renderForm(me());
    await actor.upload(fileInput(), new File(["png-data"], "avatar.png", { type: "image/png" }));
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    const repositionButtons = screen.getAllByRole("button", { name: "Reposition" });
    await actor.click(repositionButtons[repositionButtons.length - 1]!);
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
  });

  it("falls back to image/png when repositioning a saved image with no content type", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["data"], { type: "" }))));
    renderForm(me({
      cover_url: "/cover.jpg",
      cover_has_original: false,
      cover_content_type: null,
      cover_crop: { zoom: 1, x: 0, y: 0 },
    }));

    await actor.click(screen.getByRole("button", { name: "Reposition" }));
    expect(await screen.findByRole("dialog", { name: "Position image" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Use image" }));
    vi.unstubAllGlobals();
  });
});
