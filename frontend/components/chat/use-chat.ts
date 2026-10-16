"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnswerResult } from "@/lib/ai-answer";
import {
  ChatStreamError,
  EMPTY_CHAT,
  loadChat,
  messagesToSend,
  saveChat,
  streamChat,
  type ChatEntry,
  type ChatState,
} from "@/lib/ai-chat";

type Assistant = Extract<ChatEntry, { role: "assistant" }>;

let counter = 0;
/** An id for a turn. Not ``crypto.randomUUID``: that does not exist on a page served over plain http. */
function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function finished(result: AnswerResult): Partial<Assistant> {
  return {
    status: "done",
    content: result.found ? result.answer : "",
    found: result.found,
    reason: result.reason,
    sources: result.sources,
    related: result.related,
    basis: result.basis ?? "wiki",
    webSources: result.web_sources ?? [],
    searching: undefined,
  };
}

/**
 * The state of one conversation with the wiki: what was asked and answered, the reply that is
 * being written, and the means to ask, stop, edit a question (keeping its earlier versions to go
 * back to), try again and start over. It is kept in this browser for this person, and nowhere
 * else.
 */
export function useChat(userId: string) {
  const [state, setState] = useState<ChatState>(EMPTY_CHAT);
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef<ChatState>(EMPTY_CHAT);
  const controllerRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: ChatState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patchAssistant = useCallback(
    (id: string, patch: (entry: Assistant) => Partial<Assistant>) => {
      const { entries, slots } = stateRef.current;
      commit({
        slots,
        entries: entries.map((entry) =>
          entry.id === id && entry.role === "assistant"
            ? ({ ...entry, ...patch(entry) } as ChatEntry)
            : entry,
        ),
      });
    },
    [commit],
  );

  /** The edited question has its reply (or failed): going back is no longer a way to undo it. */
  const settle = useCallback(
    (slot: string | undefined) => {
      const { entries, slots } = stateRef.current;
      if (!slot || slots[slot]?.pending === undefined) return;
      commit({
        entries,
        slots: { ...slots, [slot]: { ...slots[slot], pending: undefined } },
      });
    },
    [commit],
  );

  // Read what this browser kept - after mount, so the server and the first paint agree.
  useEffect(() => {
    commit(loadChat(userId));
    setLoaded(true);
  }, [userId, commit]);

  useEffect(() => {
    if (loaded) saveChat(userId, state);
  }, [userId, state, loaded]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const busy = state.entries.some(
    (entry) => entry.role === "assistant" && entry.status === "streaming",
  );

  const send = useCallback(
    async (text: string, slot?: string) => {
      const question = text.trim();
      if (!question || controllerRef.current) return;

      const reply: Assistant = {
        id: newId(),
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const { entries, slots } = stateRef.current;
      const withQuestion: ChatEntry[] = [
        ...entries,
        {
          id: newId(),
          role: "user",
          content: question,
          ...(slot ? { slot } : {}),
        },
      ];
      const toSend = messagesToSend(withQuestion);
      commit({ entries: [...withQuestion, reply], slots });

      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const result = await streamChat(toSend, {
          signal: controller.signal,
          onDelta: (piece) =>
            patchAssistant(reply.id, (entry) => ({
              content: entry.content + piece,
              searching: undefined,
            })),
          onSearching: (query) =>
            patchAssistant(reply.id, () => ({ searching: query })),
        });
        patchAssistant(reply.id, () => finished(result));
        settle(slot);
      } catch (error) {
        if (controller.signal.aborted) return; // stopped on purpose: stop() has tidied up
        patchAssistant(reply.id, () => ({
          status: "error",
          content: "",
          failure: error instanceof ChatStreamError ? error.failure : "error",
        }));
        settle(slot);
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [commit, patchAssistant, settle],
  );

  /**
   * Ask a question again with other words. The old question, with everything that followed it,
   * is kept as an earlier version; the conversation carries on from the edited one.
   */
  const edit = useCallback(
    (id: string, text: string) => {
      if (controllerRef.current || !text.trim()) return;
      const { entries, slots } = stateRef.current;
      const at = entries.findIndex(
        (entry) => entry.id === id && entry.role === "user",
      );
      if (at < 0) return;
      const first = entries[at];
      const slotId = first.role === "user" ? (first.slot ?? first.id) : id;
      const tail = entries
        .slice(at)
        .map((entry, i) =>
          i === 0 && entry.role === "user" ? { ...entry, slot: slotId } : entry,
        );
      const current = slots[slotId] ?? { variants: [tail], active: 0 };
      const variants = [...current.variants];
      variants[current.active] = tail;
      variants.push([]); // the edited version: filled in when it is switched away from
      commit({
        entries: entries.slice(0, at),
        slots: {
          ...slots,
          [slotId]: {
            variants,
            active: variants.length - 1,
            pending: current.active,
          },
        },
      });
      void send(text, slotId);
    },
    [commit, send],
  );

  /** Show another version of an edited question, with what followed it. */
  const switchVersion = useCallback(
    (slotId: string, delta: -1 | 1) => {
      if (controllerRef.current) return;
      const { entries, slots } = stateRef.current;
      const slot = slots[slotId];
      const at = entries.findIndex(
        (entry) => entry.role === "user" && entry.slot === slotId,
      );
      const target = slot ? slot.active + delta : -1;
      if (!slot || at < 0 || target < 0 || target >= slot.variants.length) {
        return;
      }
      const variants = [...slot.variants];
      variants[slot.active] = entries.slice(at);
      commit({
        entries: [...entries.slice(0, at), ...variants[target]],
        slots: { ...slots, [slotId]: { variants, active: target } },
      });
    },
    [commit],
  );

  /** Give up on the reply being written; the question goes back to be edited or sent again. */
  const stop = useCallback((): string => {
    const controller = controllerRef.current;
    if (!controller) return "";
    controller.abort();
    controllerRef.current = null;
    const { entries, slots } = stateRef.current;
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    // A reply is only ever under way as the last of a question and its reply, so the guard
    // below cannot trigger; it is there so a broken state is left alone rather than cut into.
    /* v8 ignore next 7 -- @preserve */
    if (
      last?.role !== "assistant" ||
      last.status !== "streaming" ||
      asked?.role !== "user"
    ) {
      return "";
    }
    const prefix = entries.slice(0, -2);
    const slot = asked.slot ? slots[asked.slot] : undefined;
    if (asked.slot && slot && slot.pending !== undefined) {
      // An edit that was stopped is undone: the version it replaced comes back.
      const variants = slot.variants.slice(0, -1);
      const back = variants[slot.pending] ?? [];
      const rest = { ...slots };
      delete rest[asked.slot];
      commit({
        entries: [...prefix, ...back],
        slots:
          variants.length > 1
            ? { ...rest, [asked.slot]: { variants, active: slot.pending } }
            : rest,
      });
      return asked.content;
    }
    commit({ entries: prefix, slots });
    return asked.content;
  }, [commit]);

  /** Ask the last question again, after a reply that failed. */
  const retry = useCallback(() => {
    const { entries, slots } = stateRef.current;
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    if (
      last?.role !== "assistant" ||
      last.status !== "error" ||
      asked?.role !== "user"
    ) {
      return;
    }
    commit({ entries: entries.slice(0, -2), slots });
    void send(asked.content, asked.slot);
  }, [commit, send]);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    commit(EMPTY_CHAT);
  }, [commit]);

  /** Carry on from a question that was answered in the search box. */
  const adopt = useCallback(
    (question: string, result: AnswerResult) => {
      if (controllerRef.current) return;
      const { entries, slots } = stateRef.current;
      commit({
        slots,
        entries: [
          ...entries,
          { id: newId(), role: "user", content: question },
          {
            id: newId(),
            role: "assistant",
            ...(finished(result) as Omit<Assistant, "id" | "role">),
          } as Assistant,
        ],
      });
    },
    [commit],
  );

  return {
    entries: state.entries,
    slots: state.slots,
    loaded,
    busy,
    send,
    edit,
    switchVersion,
    stop,
    retry,
    clear,
    adopt,
  };
}
