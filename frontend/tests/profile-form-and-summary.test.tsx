import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/account/profile-form";
import { ProfileSummary } from "@/components/account/profile-summary";
import { ApiError, api } from "@/lib/api-client";
import type { Me } from "@/types/api";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
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
  render(<ProfileForm user={user} onCancel={onCancel} onSaved={onSaved} {...props} />);
  return { onSaved, onCancel };
}

const save = () => screen.getByRole("button", { name: "Save changes" });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("ProfileForm", () => {
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
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:preview");
    await actor.click(save());
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][0]).toBe("/api/v1/users/me/avatar");
    expect(mocked.post.mock.calls[0][2]).toMatchObject({ rawBody: expect.any(FormData) });
  });

  it("replaces a previous preview and revokes the old one", async () => {
    const actor = userEvent.setup();
    renderForm();
    await actor.upload(fileInput(), png("one.png"));
    await actor.upload(fileInput(), png("two.png"));
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
});

describe("ProfileSummary", () => {
  it("shows the essentials for a bare member", () => {
    const onEdit = vi.fn();
    render(<ProfileSummary user={me()} onEdit={onEdit} />);
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
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
        } as Partial<Me>)}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("About me")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
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
});
