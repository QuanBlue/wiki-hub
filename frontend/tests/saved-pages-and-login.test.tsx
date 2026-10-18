import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";
import { SavedPagesList } from "@/components/recent/saved-pages-list";
import { ApiError, api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/components/auth/auth-panels", () => ({
  AuthPanels: ({ initialView }: { initialView: string }) => (
    <div data-testid="panels">{initialView}</div>
  ),
}));
vi.mock("@/components/brand/logo", () => ({
  Wordmark: ({ siteName }: { siteName: string }) => <span data-testid="wordmark">{siteName}</span>,
}));

const mocked = vi.mocked(api);
const KEY = "wikihub:saved-page-keys";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("SavedPagesList", () => {
  it("explains when nothing is saved", async () => {
    render(<SavedPagesList />);
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("treats corrupt or non-array storage as empty", async () => {
    window.localStorage.setItem(KEY, "{not json");
    const first = render(<SavedPagesList />);
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    first.unmount();

    window.localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    render(<SavedPagesList />);
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("lists saved pages, resolving titles", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ENG/run book", 7, "ENG/other", "ONLYSPACE"]));
    mocked.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/run%20book")) return { title: "Run book" };
      if (url.endsWith("/other")) throw new ApiError(500, "x", "boom");
      return { title: "Space page" };
    });
    render(<SavedPagesList />);

    expect(await screen.findByText("Run book")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Run book/ })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/run%20book",
    );
    // A transient failure shows as unavailable but stays in the list.
    await waitFor(() => expect(screen.getAllByText("No longer available").length).toBeGreaterThan(0));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toContain("ENG/other");
    expect(screen.getByRole("link", { name: /ONLYSPACE/ })).toHaveAttribute(
      "href",
      "/spaces/ONLYSPACE/pages",
    );
  });

  it("shows a loading hint until a page resolves", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ENG/slow"]));
    let resolve: (value: unknown) => void = () => {};
    mocked.get.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SavedPagesList />);
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    await act(async () => resolve({ title: "Slow page" }));
    expect(await screen.findByText("Slow page")).toBeInTheDocument();
  });

  it("prunes a page that no longer exists", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ENG/gone", "ENG/kept"]));
    mocked.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/gone")) throw new ApiError(404, "nf", "missing");
      return { title: "Kept" };
    });
    render(<SavedPagesList />);

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(["ENG/kept"]),
    );
    await waitFor(() => expect(screen.queryByText("gone")).not.toBeInTheDocument());
    expect(await screen.findByText("Kept")).toBeInTheDocument();
  });

  it("still drops a dead page when storage refuses writes", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ENG/gone"]));
    mocked.get.mockRejectedValue(new ApiError(404, "nf", "missing"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<SavedPagesList />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalled());
    expect(await screen.findByText("No longer available")).toBeInTheDocument();
  });

  it("follows changes from other tabs and the same tab", async () => {
    render(<SavedPagesList />);
    await screen.findByText("Nothing saved yet");
    mocked.get.mockResolvedValue({ title: "New one" });

    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify(["ENG/new"]));
      window.dispatchEvent(new Event("storage"));
    });
    expect(await screen.findByText("New one")).toBeInTheDocument();

    act(() => {
      window.localStorage.setItem(KEY, "[]");
      window.dispatchEvent(new Event("wikihub:saved-pages-changed"));
    });
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("ignores a response that arrives after unmounting", async () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ENG/late", "ENG/late-fail"]));
    const resolvers: Array<{ ok: (v: unknown) => void; fail: (e: unknown) => void }> = [];
    mocked.get.mockImplementation(
      () =>
        new Promise((ok, fail) => {
          resolvers.push({ ok, fail });
        }),
    );
    const view = render(<SavedPagesList />);
    await waitFor(() => expect(resolvers).toHaveLength(2));
    view.unmount();
    await act(async () => {
      resolvers[0].ok({ title: "Late" });
      resolvers[1].fail(new ApiError(404, "nf", "missing"));
    });
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toHaveLength(2);
  });
});

describe("LoginPage", () => {
  it("renders the marketing panel and the sign-in form", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("panels")).toHaveTextContent("login");
    expect(screen.getAllByTestId("wordmark")).toHaveLength(2);
    expect(screen.getByText("auth.headline")).toBeInTheDocument();
    expect(screen.getByText("auth.featControlTitle")).toBeInTheDocument();
  });

  it("opens the contact view when asked", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ view: "contact" }) }));
    expect(screen.getByTestId("panels")).toHaveTextContent("contact");
  });
});
