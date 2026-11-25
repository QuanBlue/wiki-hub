"use client";

import { useEffect, useState } from "react";

import { fetchChatKey } from "@/lib/chat-key";
import { closeChatVault, openChatVault } from "@/lib/chat-vault";

/** How long to wait before asking for the key a second and last time. */
export const KEY_RETRY_MS = 1000;

export type ChatVaultState = "opening" | "ready" | "failed";

/**
 * Open the person's kept chats before anything reads them. ``failed`` means the key could not
 * be had: what is stored is left alone. Nothing is asked while nothing is to be kept
 * (``persist`` false) or the chat is not shown (``wanted`` false).
 */
export function useChatVault(
  userId: string,
  persist: boolean,
  wanted: boolean,
): ChatVaultState {
  const [done, setDone] = useState<{ userId: string; ok: boolean }>();

  useEffect(() => {
    if (!persist || !wanted) return;
    let alive = true;
    let timer = 0;
    const ask = (again: boolean) =>
      fetchChatKey().then(
        ({ key, keyId }) => {
          if (!alive) return;
          openChatVault(userId, key, keyId);
          setDone({ userId, ok: true });
        },
        () => {
          if (!alive) return;
          if (again) {
            timer = window.setTimeout(() => void ask(false), KEY_RETRY_MS);
          } else setDone({ userId, ok: false });
        },
      );
    void ask(true);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      // Signed out, or someone else: let go of the key.
      closeChatVault();
      setDone(undefined);
    };
  }, [userId, persist, wanted]);

  if (!persist) return "ready";
  if (done?.userId !== userId) return "opening";
  return done.ok ? "ready" : "failed";
}
