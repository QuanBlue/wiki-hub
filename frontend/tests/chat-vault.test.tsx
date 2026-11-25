import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KEY_RETRY_MS, useChatVault } from "@/components/chat/use-chat-vault";
import {
  chatKey,
  chatStorage,
  keepChatsInMemory,
  loadAttached,
  loadDraft,
  saveAttached,
  saveDraft,
  type ChatEntry,
} from "@/lib/ai-chat";
import {
  listThreads,
  loadThread,
  saveThread,
  searchThreads,
  updateThread,
} from "@/lib/ai-chat-store";
import { api } from "@/lib/api-client";
import { fetchChatKey } from "@/lib/chat-key";
import { isSealed, seal, unseal } from "@/lib/chat-seal";
import { closeChatVault, openChatVault, setChatKey } from "@/lib/chat-vault";

// The real cipher and the real call for the key, unlike the rest of the tests.
vi.unmock("@/lib/chat-seal");
vi.unmock("@/lib/chat-key");
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const keyOf = (byte: number) => new Uint8Array(32).fill(byte);
const MINE = keyOf(1);
const answer = (key: Uint8Array, keyId: string) => ({
  key: btoa(String.fromCharCode(...key)),
  key_id: keyId,
});
const talk = (question: string): ChatEntry[] => [
  { id: "q", role: "user", content: question },
  {
    id: "a",
    role: "assistant",
    content: `about ${question}`,
    status: "done",
    found: true,
  },
];
/** Everything the browser holds, as someone reading its storage would see it. */
const everything = () =>
  Array.from({ length: window.localStorage.length }, (_, at) => {
    const name = window.localStorage.key(at)!;
    return `${name}=${window.localStorage.getItem(name)}`;
  }).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  keepChatsInMemory(false);
  openChatVault("u1", MINE, "k1");
});
afterEach(() => {
  vi.useRealTimers();
  closeChatVault();
});

describe("a sealed value", () => {
  it.each([
    ["", "nothing"],
    ["Máy chủ thanh toán ở đâu? 🙂", "Vietnamese and signs"],
    ["the same words again. ".repeat(20_000), "a long thread"],
  ])("opens as it was written (%#: %s)", (text) => {
    const sealed = seal(MINE, "name", text);

    expect(isSealed(sealed)).toBe(true);
    expect(unseal(MINE, "name", sealed)).toBe(text);
  });

  it("is smaller than long words, and different every time", () => {
    const text = "the same words again. ".repeat(20_000);

    expect(seal(MINE, "n", text).length).toBeLessThan(text.length / 5);
    expect(seal(MINE, "n", "secret")).not.toBe(seal(MINE, "n", "secret"));
  });

  it("does not open with another key, under another name, or once changed", () => {
    const sealed = seal(MINE, "name", "secret");
    const changed = `${sealed.slice(0, 40)}${sealed[40] === "A" ? "B" : "A"}${sealed.slice(41)}`;

    expect(unseal(keyOf(2), "name", sealed)).toBeNull();
    expect(unseal(MINE, "other", sealed)).toBeNull();
    expect(unseal(MINE, "name", changed)).toBeNull();
    expect(unseal(MINE, "name", "e1:not base64!")).toBeNull();
    expect(unseal(MINE, "name", "plain words")).toBeNull();
  });
});

describe("what the browser keeps", () => {
  const keepAll = () => {
    saveThread("u1", "t", { entries: talk("payroll password"), slots: {} });
    updateThread("u1", "t", { title: "Salaries", titleSource: "manual" });
    saveDraft("u1", "unsent words", "t");
    saveAttached("u1", [{ id: "f", filename: "bonus.xlsx" }], "t");
  };

  it("shows no words, names or file names to someone reading the storage", () => {
    keepAll();

    for (const secret of ["payroll", "Salaries", "unsent", "bonus"]) {
      expect(everything()).not.toContain(secret);
    }
    expect(loadThread("u1", "t").entries).toHaveLength(2);
    expect(listThreads("u1")[0].title).toBe("Salaries");
    expect(loadDraft("u1", "t")).toBe("unsent words");
    expect(loadAttached("u1", "t")[0].filename).toBe("bonus.xlsx");
    expect(searchThreads("u1", "payroll")).toHaveLength(1);
  });

  it("cannot be read or written once the key is gone, and opens again with it", () => {
    keepAll();
    const before = everything();
    closeChatVault();

    expect(chatStorage()).toBeNull();
    expect(listThreads("u1")).toEqual([]);
    expect(loadDraft("u1", "t")).toBe("");
    saveThread("u1", "new", { entries: talk("in the clear?"), slots: {} });
    saveDraft("u1", "in the clear?", "new");
    expect(everything()).toBe(before);

    openChatVault("u1", MINE, "k1");
    expect(listThreads("u1")[0].title).toBe("Salaries");
  });

  it("seals what was written before there was a lock", () => {
    const name = chatKey("u1", "draft", "t");
    const theirs = chatKey("u2", "draft", "t");
    window.localStorage.setItem(name, "old words");
    window.localStorage.setItem(theirs, "their words");
    // Still read before it is sealed.
    expect(loadDraft("u1", "t")).toBe("old words");

    openChatVault("u1", MINE, "k1");

    expect(isSealed(window.localStorage.getItem(name)!)).toBe(true);
    expect(loadDraft("u1", "t")).toBe("old words");
    // Another person's is theirs to seal.
    expect(window.localStorage.getItem(theirs)).toBe("their words");
  });

  it("leaves what it cannot seal for want of room, still readable", () => {
    const name = chatKey("u1", "draft", "t");
    window.localStorage.setItem(name, "old words");
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === name) throw new Error("full");
      write.call(this, key, value);
    });

    openChatVault("u1", MINE, "k1");

    expect(loadDraft("u1", "t")).toBe("old words");
  });

  it("keeps the former chats when the server's key changes, and brings them back with it", () => {
    keepAll();

    openChatVault("u1", keyOf(2), "k2");
    expect(listThreads("u1")).toEqual([]);
    saveThread("u1", "later", { entries: talk("after"), slots: {} });
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["later"]);

    openChatVault("u1", MINE, "k1");
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["t"]);
    expect(loadThread("u1", "t").entries).toHaveLength(2);

    openChatVault("u1", keyOf(2), "k2");
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["later"]);
  });

  /** A storage that refuses a new thread while the named one is still there. */
  function fullWhile(there: string) {
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key.endsWith(":thread:fresh") && this.getItem(there) !== null) {
        throw new Error("full");
      }
      write.call(this, key, value);
    });
  }

  it("makes room from whoever was here longest ago, though it cannot open their list", () => {
    openChatVault("old", keyOf(3), "k3");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    saveThread("old", "o", { entries: talk("old"), slots: {} });
    openChatVault("recent", keyOf(4), "k4");
    vi.setSystemTime(2_000);
    saveThread("recent", "r", { entries: talk("recent"), slots: {} });
    openChatVault("u1", MINE, "k1");
    fullWhile(chatKey("old", "thread", "o"));

    saveThread("u1", "fresh", { entries: talk("now"), slots: {} });

    expect(everything()).not.toContain("wikihub:chat:v2:old:");
    expect(everything()).toContain("wikihub:chat:v2:recent:thread:r");
    expect(loadThread("u1", "fresh").entries).toHaveLength(2);
  });

  it("makes room from what a former key sealed before from a readable thread", () => {
    saveThread("u1", "former", { entries: talk("former"), slots: {} });
    openChatVault("u1", keyOf(2), "k2");
    saveThread("u1", "kept", { entries: talk("kept"), slots: {} });
    fullWhile(chatKey("u1", "thread", "former"));

    saveThread("u1", "fresh", { entries: talk("now"), slots: {} });

    expect(everything()).not.toContain(":thread:former");
    expect(
      listThreads("u1")
        .map((meta) => meta.id)
        .sort(),
    ).toEqual(["fresh", "kept"]);
  });

  it("is left alone when the browser's storage is blocked", () => {
    closeChatVault();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => openChatVault("u1", MINE, "k1")).not.toThrow();
    expect(chatStorage()).toBeNull();
  });

  it("is an ordinary storage to those who walk through it", () => {
    saveDraft("u1", "words", "t");
    const store = chatStorage()!;

    expect(store.length).toBe(window.localStorage.length);
    expect(store.key(0)).toBe(window.localStorage.key(0));
    expect(store.getItem("nothing")).toBeNull();
    store.clear();
    expect(window.localStorage).toHaveLength(0);
    setChatKey(null);
    expect(chatStorage()).toBeNull();
  });
});

describe("the key from the server", () => {
  it("is asked for and read", async () => {
    vi.mocked(api.get).mockResolvedValue(answer(MINE, "k1"));

    await expect(fetchChatKey()).resolves.toEqual({ key: MINE, keyId: "k1" });
    expect(api.get).toHaveBeenCalledWith("/api/v1/ai/chat/key");
  });

  it.each([[answer(new Uint8Array(16), "k1")], [answer(MINE, "")]])(
    "is refused when it is not one (%#)",
    async (reply) => {
      vi.mocked(api.get).mockResolvedValue(reply);

      await expect(fetchChatKey()).rejects.toThrow("not a chat key");
    },
  );

  it("opens the chats of whoever is signed in, and is let go of afterwards", async () => {
    closeChatVault();
    vi.mocked(api.get).mockResolvedValue(answer(MINE, "k1"));
    const { result, unmount } = renderHook(() =>
      useChatVault("u1", true, true),
    );

    expect(result.current).toBe("opening");
    await waitFor(() => expect(result.current).toBe("ready"));
    expect(chatStorage()).not.toBeNull();
    unmount();
    expect(chatStorage()).toBeNull();
  });

  it("is not asked for while nothing is shown or nothing is to be kept", () => {
    const hidden = renderHook(() => useChatVault("u1", true, false));
    const viewing = renderHook(() => useChatVault("u1", false, true));

    expect(hidden.result.current).toBe("opening");
    expect(viewing.result.current).toBe("ready");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("is asked for once more before giving up, leaving the chats as they are", async () => {
    saveDraft("u1", "words", "t");
    const before = everything();
    closeChatVault();
    vi.useFakeTimers();
    vi.mocked(api.get).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useChatVault("u1", true, true));

    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(result.current).toBe("opening");
    await act(
      async () => void (await vi.advanceTimersByTimeAsync(KEY_RETRY_MS)),
    );

    expect(result.current).toBe("failed");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(chatStorage()).toBeNull();
    expect(everything()).toBe(before);
  });

  it("is ignored when it comes after the person has gone", async () => {
    closeChatVault();
    let give: (value: unknown) => void = () => {};
    let refuse: (reason: unknown) => void = () => {};
    vi.mocked(api.get)
      .mockReturnValueOnce(new Promise((resolve) => (give = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));

    renderHook(() => useChatVault("u1", true, true)).unmount();
    renderHook(() => useChatVault("u2", true, true)).unmount();
    await act(async () => {
      give(answer(MINE, "k1"));
      refuse(new Error("late"));
    });

    expect(chatStorage()).toBeNull();
  });
});
