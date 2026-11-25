"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { keepChatsInMemory } from "@/lib/ai-chat";
import {
  activeThread,
  deleteThread,
  listThreads,
  migrateLegacyChat,
  newThreadId,
  setActiveThread,
  subscribeThreads,
  updateThread,
  type ThreadMeta,
} from "@/lib/ai-chat-store";

/**
 * This person's threads with the assistant, and the one that is open. A new chat is a thread
 * that is not in the list yet: it joins it with its first question.
 *
 * ``persist`` is false while an administrator views the wiki as someone else: the threads then
 * live only in this page.
 */
export function useChatThreads(userId: string, persist = true) {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeId, setActiveId] = useState<string>(() => newThreadId());
  const [ready, setReady] = useState(false);
  const activeRef = useRef(activeId);

  const refresh = useCallback(() => setThreads(listThreads(userId)), [userId]);

  // After mount, so the server and the first paint agree.
  useEffect(() => {
    keepChatsInMemory(!persist);
    const migrated = persist ? migrateLegacyChat(userId) : undefined;
    const open = migrated ?? activeThread(userId) ?? listThreads(userId)[0]?.id;
    const id = open ?? newThreadId();
    activeRef.current = id;
    // Read from the browser once it is there, which is only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(id);
    setThreads(listThreads(userId));
    setReady(true);
  }, [userId, persist]);

  useEffect(
    () =>
      subscribeThreads(userId, () => {
        const next = listThreads(userId);
        setThreads(next);
      }),
    [userId],
  );

  const select = useCallback(
    (id: string) => {
      activeRef.current = id;
      setActiveId(id);
      setActiveThread(userId, id);
    },
    [userId],
  );

  /** Open a new, empty thread; returns its id. An empty one that is open already is kept. */
  const startNew = useCallback((): string => {
    const current = activeRef.current;
    if (!listThreads(userId).some((meta) => meta.id === current)) {
      return current;
    }
    const id = newThreadId();
    activeRef.current = id;
    setActiveId(id);
    setActiveThread(userId, id);
    return id;
  }, [userId]);

  const rename = useCallback(
    (id: string, title: string) => {
      const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
      if (!clean) return;
      updateThread(userId, id, { title: clean, titleSource: "manual" });
    },
    [userId],
  );

  /** A name the assistant found: taken only if the person has not named the thread themselves. */
  const nameByAssistant = useCallback(
    (id: string, title: string) => {
      const meta = listThreads(userId).find((thread) => thread.id === id);
      const clean = String(title ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (!meta || meta.titleSource === "manual" || !clean) return;
      updateThread(userId, id, { title: clean, titleSource: "ai" });
    },
    [userId],
  );

  const togglePin = useCallback(
    (id: string) => {
      const meta = listThreads(userId).find((thread) => thread.id === id);
      if (meta) updateThread(userId, id, { pinned: !meta.pinned });
    },
    [userId],
  );

  /** Remove a thread; when it was open, the most recent other one opens (or a new one). */
  const remove = useCallback(
    (id: string) => {
      deleteThread(userId, id);
      if (activeRef.current === id) {
        const next = listThreads(userId)[0]?.id ?? newThreadId();
        activeRef.current = next;
        setActiveId(next);
        setActiveThread(userId, next);
      }
      refresh();
    },
    [userId, refresh],
  );

  const active = threads.find((meta) => meta.id === activeId);

  return {
    threads,
    activeId,
    active,
    ready,
    select,
    startNew,
    rename,
    nameByAssistant,
    togglePin,
    remove,
  };
}
