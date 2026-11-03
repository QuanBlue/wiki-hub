import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePagePresence } from "@/lib/use-page-presence";
import { api } from "@/lib/api-client";
import { apiBaseUrl } from "@/lib/env";

vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
vi.mock("@/lib/env", () => ({ apiBaseUrl: vi.fn(() => "") }));

const alice = { user_id: "alice", username: "alice", full_name: "Alice", state: "editing", last_seen: "" };
const bob = { user_id: "bob", username: "bob", full_name: "Bob", state: "viewing", last_seen: "" };

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

describe("usePagePresence", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.mocked(api.post).mockReset();
    vi.mocked(apiBaseUrl).mockReturnValue("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not connect without a page and closes an active socket on unmount", () => {
    const empty = renderHook(() => usePagePresence({ spaceKey: null, pageSlug: null, editing: false }));
    expect(empty.result.current.activeUsers).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(0);
    empty.unmount();

    const connected = renderHook(() => usePagePresence({ spaceKey: "ENG", pageSlug: "runbook", editing: true }));
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toContain("/spaces/ENG/pages/runbook/presence/ws?editing=1");
    connected.unmount();
    expect(socket.close).toHaveBeenCalledOnce();
    act(() => socket.onopen?.());
    expect(socket.close).toHaveBeenCalledTimes(2);
  });

  it("tracks other users and page saves from websocket frames", () => {
    const saved = vi.fn();
    const { result, unmount } = renderHook(() =>
      usePagePresence({ spaceKey: "ENG", pageSlug: "runbook", editing: false, currentUserId: "alice", onPageSaved: saved }),
    );
    const socket = FakeSocket.instances[0]!;
    act(() => {
      socket.readyState = FakeSocket.OPEN;
      socket.onopen?.();
      socket.message({ type: "sync", users: [alice, bob], page_updated_at: "t1" });
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.activeUsers).toEqual([bob]);

    act(() => {
      socket.message({ type: "presence_update", user: alice });
      socket.message({ type: "presence_update", user: { ...bob, username: "Bobby" } });
      socket.message({ type: "page_saved", actor_id: "alice", saved_at: "t2", title: "Own" });
      socket.message({ type: "page_saved", actor_id: "bob", saved_at: "t3", title: "New" });
      socket.message({ type: "presence_leave", user_id: "bob" });
      socket.onmessage?.({ data: "invalid json" });
    });
    expect(result.current.activeUsers).toEqual([]);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ actor_id: "bob" }));
    unmount();
  });

  it("sends heartbeats over HTTPS websocket and falls back when the socket closes", async () => {
    vi.useFakeTimers();
    vi.mocked(apiBaseUrl).mockReturnValue("https://wiki.example");
    vi.mocked(api.post).mockResolvedValue({ users: [], page_updated_at: null });
    const { unmount } = renderHook(() =>
      usePagePresence({ spaceKey: "ENG", pageSlug: "runbook", editing: true }),
    );
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toMatch(/^wss:\/\/wiki.example/);
    await act(async () => {
      socket.readyState = FakeSocket.OPEN;
      socket.onopen?.();
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ action: "heartbeat", editing: true }));
    await act(async () => {
      socket.onclose?.();
      await Promise.resolve();
    });
    expect(api.post).toHaveBeenCalledOnce();
    unmount();
  });

  it("polls when a websocket cannot be constructed and reports a failed poll", async () => {
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error("unavailable"); } });
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));
    const { result, unmount } = renderHook(() =>
      usePagePresence({ spaceKey: "ENG", pageSlug: "runbook", editing: false }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledOnce();
    expect(result.current.isConnected).toBe(false);
    unmount();
  });

  it("falls back to HTTP polling after a socket error", async () => {
    vi.useFakeTimers();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ users: [alice, bob], page_updated_at: "t1" })
      .mockResolvedValueOnce({ users: [bob], page_updated_at: "t2" });
    const saved = vi.fn();
    const { result, unmount } = renderHook(() =>
      usePagePresence({ spaceKey: "ENG", pageSlug: "runbook", editing: true, currentUserId: "alice", onPageSaved: saved }),
    );
    const socket = FakeSocket.instances[0]!;
    await act(async () => {
      socket.onerror?.();
      await Promise.resolve();
    });
    expect(result.current.activeUsers).toEqual([bob]);
    expect(api.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/runbook/presence/heartbeat", { editing: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ saved_at: "t2" }));
    unmount();
  });
});
