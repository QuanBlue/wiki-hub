"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnswerResult } from "@/lib/ai-answer";
import {
  ChatStreamError,
  clearStoredChats,
  EMPTY_CHAT,
  executePlan,
  type ChatDetail,
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
    actions: result.actions ?? [],
    plan: result.plan
      ? {
          steps: result.plan.steps,
          skipped: result.plan.skipped,
          // Nothing to confirm when every step was left out.
          status: result.plan.steps.length
            ? ("pending" as const)
            : ("done" as const),
          results: [],
        }
      : undefined,
    searching: undefined,
  };
}

/**
 * The state of one conversation with the wiki: what was asked and answered, the reply that is
 * being written, and the means to ask, stop, edit a question (keeping its earlier versions to go
 * back to), try again and start over. It is kept in this browser for this person, and nowhere
 * else.
 */
export function useChat(
  userId: string,
  detail: ChatDetail = "normal",
  fileId: string | null = null,
) {
  const [state, setState] = useState<ChatState>(EMPTY_CHAT);
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef<ChatState>(EMPTY_CHAT);
  const controllerRef = useRef<AbortController | null>(null);
  // The level chosen now, read when a question is sent (also when one is asked again).
  const detailRef = useRef<ChatDetail>(detail);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  // The file questions are asked about now, if any; read when a question is sent.
  const fileRef = useRef<string | null>(fileId);
  useEffect(() => {
    fileRef.current = fileId;
  }, [fileId]);

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
    // Whatever another person left in this browser goes before this one's is read.
    clearStoredChats(userId);
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
          detail: detailRef.current,
          attachmentId: fileRef.current,
          onDelta: (piece) =>
            patchAssistant(reply.id, (entry) => ({
              content: entry.content + piece,
              searching: undefined,
            })),
          onSearching: (query) =>
            patchAssistant(reply.id, () => ({ searching: query })),
          onReset: () =>
            patchAssistant(reply.id, () => ({
              content: "",
              searching: undefined,
            })),
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

  /**
   * Give up on the reply being written. The question stays in the conversation, with what was
   * written of the reply and a note that it was cancelled; asking again is one press away.
   */
  const stop = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.abort();
    controllerRef.current = null;
    const { entries } = stateRef.current;
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    // A reply is only ever under way as the last of a question and its reply, so the guard
    // below cannot trigger; it is there so a broken state is left alone rather than cut into.
    /* v8 ignore next 3 -- @preserve */
    if (last?.role !== "assistant" || last.status !== "streaming") return;
    patchAssistant(last.id, () => ({
      status: "cancelled",
      searching: undefined,
    }));
    // A cancelled edit stays too, next to the version it was made from.
    settle(asked?.role === "user" ? asked.slot : undefined);
  }, [patchAssistant, settle]);

  /** Ask the last question again, after a reply that failed or was cancelled. */
  const retry = useCallback(() => {
    const { entries, slots } = stateRef.current;
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    if (
      last?.role !== "assistant" ||
      (last.status !== "error" && last.status !== "cancelled") ||
      asked?.role !== "user"
    ) {
      return;
    }
    commit({ entries: entries.slice(0, -2), slots });
    void send(asked.content, asked.slot);
  }, [commit, send]);

  /**
   * Answer a question again. It is an edit that changes nothing: the earlier reply, with what
   * followed it, is kept as a version to go back to, and the new reply becomes the latest.
   * Unlike ``retry`` this works for any question, not only after a failure.
   */
  const regenerate = useCallback(
    (id: string) => {
      const asked = stateRef.current.entries.find((entry) => entry.id === id);
      if (asked?.role === "user") edit(id, asked.content);
    },
    [edit],
  );

  /** The person confirmed a proposed plan: run its steps, showing each as it ends. */
  const runPlan = useCallback(
    async (id: string, lang: string): Promise<boolean> => {
      const found = stateRef.current.entries.find(
        (entry) => entry.id === id && entry.role === "assistant",
      ) as Assistant | undefined;
      if (!found?.plan || found.plan.status !== "pending") return false;
      patchAssistant(id, (entry) => ({
        plan: { ...entry.plan!, status: "running", results: [] },
      }));
      try {
        const ok = await executePlan(found.plan.steps, {
          lang,
          onStep: (step) =>
            patchAssistant(id, (entry) => ({
              plan: { ...entry.plan!, results: [...entry.plan!.results, step] },
            })),
        });
        patchAssistant(id, (entry) => ({
          plan: { ...entry.plan!, status: ok ? "done" : "failed" },
        }));
        return ok;
      } catch (error) {
        patchAssistant(id, (entry) => ({
          plan: {
            ...entry.plan!,
            status: "failed",
            results: [
              ...entry.plan!.results,
              {
                ok: false,
                error:
                  error instanceof ChatStreamError ? error.failure : "error",
              },
            ],
          },
        }));
        return false;
      }
    },
    [patchAssistant],
  );

  /** The person decided not to run the plan. */
  const cancelPlan = useCallback(
    (id: string) =>
      patchAssistant(id, (entry) =>
        entry.plan?.status === "pending"
          ? { plan: { ...entry.plan, status: "cancelled" } }
          : {},
      ),
    [patchAssistant],
  );

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
    regenerate,
    runPlan,
    cancelPlan,
    clear,
    adopt,
  };
}
