"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnswerResult } from "@/lib/ai-answer";
import {
  CHAT_QUEUE_MAX,
  ChatStreamError,
  conversationFiles,
  EMPTY_CHAT,
  executePlan,
  type ChatDetail,
  messagesToCompact,
  messagesToSend,
  streamChat,
  summarizeThread,
  type AttachedFile,
  type ChatEntry,
} from "@/lib/ai-chat";
import {
  chatThreadKey,
  loadThread,
  saveThread,
  subscribeThreads,
  type QueuedQuestion,
  type ThreadData,
} from "@/lib/ai-chat-store";

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
    // Not found: empty, or the assistant saying so in its own words, with where to look.
    content: result.answer ?? "",
    found: result.found,
    reason: result.reason,
    sources: result.sources,
    related: result.related,
    basis: result.basis ?? "wiki",
    webSources: result.web_sources ?? [],
    fileSources: result.file_sources ?? [],
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

/** The summary that still holds: not one of turns the thread has since been edited past. */
function summaryFor({ entries, compact }: Omit<ThreadData, "slots">) {
  return compact && entries.some((entry) => entry.id === compact.upTo)
    ? compact
    : undefined;
}

const NOTHING_WAITING: QueuedQuestion[] = [];

/** The thread a conversation is kept in when no other is named. */
export const DEFAULT_THREAD = "default";

/** Told once a thread has the reply to its first question (to give the thread a name). */
export type FirstAnswer = {
  threadId: string;
  question: string;
  answer: string;
};

/**
 * The conversations with the wiki, one thread shown at a time: what was asked and answered, the
 * reply that is being written, and the means to ask, stop, edit a question (keeping its earlier
 * versions to go back to), try again and start over. Every thread keeps its own reply under way,
 * so opening another thread does not stop one being written. Questions asked meanwhile wait
 * their turn, in each thread, and go one by one as the replies arrive. Kept in this browser for this
 * person, and nowhere else.
 */
export function useChat(
  userId: string,
  detail: ChatDetail = "normal",
  fileId: string | null = null,
  threadId: string = DEFAULT_THREAD,
  onFirstAnswer?: (first: FirstAnswer) => void,
) {
  const [state, setState] = useState<ThreadData>(EMPTY_CHAT);
  const [loaded, setLoaded] = useState(false);
  // Threads with a reply being written, for the list of threads.
  const [running, setRunning] = useState<string[]>([]);
  // Threads whose reply arrived while another thread was shown.
  const [unread, setUnread] = useState<string[]>([]);
  const threadsRef = useRef(new Map<string, ThreadData>());
  const controllersRef = useRef(new Map<string, AbortController>());
  // Threads whose older turns are being summarised.
  const compactingRef = useRef(new Set<string>());
  const activeRef = useRef(threadId);
  const userRef = useRef(userId);
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
  const firstAnswerRef = useRef(onFirstAnswer);
  useEffect(() => {
    firstAnswerRef.current = onFirstAnswer;
  }, [onFirstAnswer]);

  /** A thread as it is now: the one in memory, else as it was kept. */
  const get = useCallback((tid: string): ThreadData => {
    const known = threadsRef.current.get(tid);
    if (known) return known;
    const kept = loadThread(userRef.current, tid);
    threadsRef.current.set(tid, kept);
    return kept;
  }, []);

  /**
   * Change a thread. It is kept at once, except while only the words of a reply arrive: those
   * are kept when the reply ends.
   */
  const commit = useCallback((tid: string, next: ThreadData, keep = true) => {
    threadsRef.current.set(tid, next);
    if (keep) saveThread(userRef.current, tid, next);
    if (tid === activeRef.current) setState(next);
  }, []);

  const syncRunning = useCallback(() => {
    setRunning([...controllersRef.current.keys()]);
  }, []);

  // Another person, or no-one yet: nothing in memory belongs to them.
  useEffect(() => {
    userRef.current = userId;
    for (const controller of controllersRef.current.values())
      controller.abort();
    controllersRef.current.clear();
    threadsRef.current.clear();
    syncRunning();
  }, [userId, syncRunning]);

  // Show the thread asked for - after mount, so the server and the first paint agree.
  useEffect(() => {
    activeRef.current = threadId;
    setUnread((ids) => ids.filter((id) => id !== threadId));
    setState(get(threadId));
    setLoaded(true);
  }, [userId, threadId, get]);

  // Another tab changed a thread: read it again, unless a reply is being written into it here.
  useEffect(
    () =>
      subscribeThreads(userId, (key) => {
        for (const tid of [...threadsRef.current.keys()]) {
          if (controllersRef.current.has(tid)) continue;
          if (key && key !== chatThreadKey(userId, tid)) continue;
          threadsRef.current.delete(tid);
          if (tid === activeRef.current) setState(get(tid));
        }
      }),
    [userId, get],
  );

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  const patchAssistant = useCallback(
    (
      tid: string,
      id: string,
      patch: (entry: Assistant) => Partial<Assistant>,
      keep = true,
    ) => {
      const current = get(tid);
      commit(
        tid,
        {
          ...current,
          entries: current.entries.map((entry) =>
            entry.id === id && entry.role === "assistant"
              ? ({ ...entry, ...patch(entry) } as ChatEntry)
              : entry,
          ),
        },
        keep,
      );
    },
    [commit, get],
  );

  /** The edited question has its reply (or failed): going back is no longer a way to undo it. */
  const settle = useCallback(
    (tid: string, slot: string | undefined) => {
      const current = get(tid);
      const { slots } = current;
      if (!slot || slots[slot]?.pending === undefined) return;
      commit(tid, {
        ...current,
        slots: { ...slots, [slot]: { ...slots[slot], pending: undefined } },
      });
    },
    [commit, get],
  );

  const busy = state.entries.some(
    (entry) => entry.role === "assistant" && entry.status === "streaming",
  );

  /** The server no longer has this file (or, unnamed, any of them): shown as expired, not sent. */
  const expire = useCallback(
    (tid: string, fileId: string | undefined) => {
      const current = get(tid);
      commit(tid, {
        ...current,
        entries: current.entries.map((entry) =>
          entry.role === "user" && entry.files?.length
            ? {
                ...entry,
                files: entry.files.map((file) =>
                  !fileId || file.id === fileId
                    ? { ...file, expired: true }
                    : file,
                ),
              }
            : entry,
        ),
      });
    },
    [commit, get],
  );

  /**
   * Summarise a long thread's older turns, so they are still remembered once they are no
   * longer read. Done after a reply, out of sight; when it fails it is tried after the next.
   */
  const compactOld = useCallback(
    async (tid: string) => {
      if (compactingRef.current.has(tid)) return;
      const { entries, compact } = get(tid);
      const before = summaryFor({ entries, compact });
      const due = messagesToCompact(entries, before?.upTo);
      if (!due) return;
      compactingRef.current.add(tid);
      const owner = userRef.current;
      try {
        const summary = await summarizeThread(
          before?.summary ?? "",
          due.messages,
        );
        const now = threadsRef.current.get(tid);
        // Removed, edited past, or another person's by now: the summary is of nothing.
        if (owner !== userRef.current || !now || !summary) return;
        if (!now.entries.some((entry) => entry.id === due.upTo)) return;
        commit(tid, {
          ...now,
          compact: {
            summary,
            upTo: due.upTo,
            count: (before?.count ?? 0) + due.count,
          },
        });
      } catch {
        // The thread carries on; only its oldest turns are not remembered yet.
      } finally {
        compactingRef.current.delete(tid);
      }
    },
    [commit, get],
  );

  // ``send``, declared below, for the question whose turn has come.
  const sendRef = useRef<
    | ((
        text: string,
        slot: undefined,
        files: AttachedFile[] | undefined,
        target: string,
        scope: string | null,
      ) => Promise<void>)
    | null
  >(null);

  /** Send the question waiting longest in a thread, unless a reply is being written there. */
  const sendNext = useCallback(
    (tid: string) => {
      if (controllersRef.current.has(tid)) return;
      const current = get(tid);
      const [next, ...queue] = current.queue ?? NOTHING_WAITING;
      if (!next) return;
      // Not kept on its own: ``send`` keeps it, as a question of the thread.
      commit(tid, { ...current, queue }, false);
      void sendRef.current?.(
        next.content,
        undefined,
        next.files,
        tid,
        next.scope ?? null,
      );
    },
    [commit, get],
  );

  /**
   * Ask a question in the thread shown. ``files`` are the ones attached with it; the files of
   * the questions before it are read again too, so a follow-up still knows them.
   */
  const send = useCallback(
    async (
      text: string,
      slot?: string,
      files: AttachedFile[] = [],
      target?: string,
      forced?: string | null,
    ) => {
      const tid = target ?? activeRef.current;
      const question = text.trim();
      if (!question || controllersRef.current.has(tid)) return;

      const reply: Assistant = {
        id: newId(),
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const current = get(tid);
      const first = !current.entries.length;
      const withQuestion: ChatEntry[] = [
        ...current.entries,
        {
          id: newId(),
          role: "user",
          content: question,
          ...(slot ? { slot } : {}),
          ...(files.length ? { files } : {}),
        },
      ];
      const toSend = messagesToSend(withQuestion);
      const fileIds = conversationFiles(withQuestion)
        .filter((file) => !file.expired)
        .map((file) => file.id);
      commit(tid, { ...current, entries: [...withQuestion, reply] });

      const controller = new AbortController();
      controllersRef.current.set(tid, controller);
      syncRunning();
      // The file asked about is the shown thread's; another thread's question has none. A
      // question that waited keeps the one it was typed with.
      const shown = tid === activeRef.current ? fileRef.current : null;
      const scope = forced === undefined ? shown : forced;
      let answered = false;
      try {
        const result = await streamChat(toSend, {
          signal: controller.signal,
          detail: detailRef.current,
          attachmentId: scope,
          fileIds: scope ? [] : fileIds,
          summary: summaryFor({ ...current, entries: withQuestion })?.summary,
          onDelta: (piece) =>
            patchAssistant(
              tid,
              reply.id,
              (entry) => ({
                content: entry.content + piece,
                searching: undefined,
              }),
              false,
            ),
          onSearching: (query) =>
            patchAssistant(tid, reply.id, () => ({ searching: query }), false),
          onReset: () =>
            patchAssistant(
              tid,
              reply.id,
              () => ({ content: "", searching: undefined }),
              false,
            ),
        });
        patchAssistant(tid, reply.id, () => finished(result));
        settle(tid, slot);
        answered = true;
        if (tid !== activeRef.current) {
          setUnread((ids) => [...ids.filter((id) => id !== tid), tid]);
        }
        void compactOld(tid);
        if (first && result.answer) {
          firstAnswerRef.current?.({
            threadId: tid,
            question,
            answer: result.answer,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return; // stopped on purpose: stop() has tidied up
        const failure =
          error instanceof ChatStreamError ? error.failure : "error";
        if (failure === "file_expired") {
          expire(
            tid,
            error instanceof ChatStreamError ? error.fileId : undefined,
          );
        }
        patchAssistant(tid, reply.id, () => ({
          status: "error",
          content: "",
          failure,
        }));
        settle(tid, slot);
      } finally {
        if (controllersRef.current.get(tid) === controller) {
          controllersRef.current.delete(tid);
          syncRunning();
          // After a failure or a stop, what waits stays until the person sends it on.
          if (answered) sendNext(tid);
        }
      }
    },
    [
      commit,
      compactOld,
      expire,
      get,
      patchAssistant,
      sendNext,
      settle,
      syncRunning,
    ],
  );
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /** Ask in the thread shown: at once, or after the reply being written there. */
  const ask = useCallback(
    (text: string, files: AttachedFile[] = []) => {
      const tid = activeRef.current;
      const content = text.trim();
      if (!content) return;
      if (!controllersRef.current.has(tid)) {
        void send(content, undefined, files, tid);
        return;
      }
      const current = get(tid);
      const queue = current.queue ?? NOTHING_WAITING;
      if (queue.length >= CHAT_QUEUE_MAX) return;
      const waiting: QueuedQuestion = {
        id: newId(),
        content,
        ...(files.length ? { files } : {}),
        ...(fileRef.current ? { scope: fileRef.current } : {}),
      };
      commit(tid, { ...current, queue: [...queue, waiting] });
    },
    [commit, get, send],
  );

  /** Take a question that is waiting out of the queue. */
  const unqueue = useCallback(
    (id: string) => {
      const tid = activeRef.current;
      const current = get(tid);
      commit(tid, {
        ...current,
        queue: (current.queue ?? NOTHING_WAITING).filter(
          (waiting) => waiting.id !== id,
        ),
      });
    },
    [commit, get],
  );

  /** Send what waits, after a stop or a failure held it back. */
  const resume = useCallback(() => sendNext(activeRef.current), [sendNext]);

  /**
   * Ask a question again with other words. The old question, with everything that followed it,
   * is kept as an earlier version; the conversation carries on from the edited one.
   */
  const edit = useCallback(
    (id: string, text: string) => {
      const tid = activeRef.current;
      if (controllersRef.current.has(tid) || !text.trim()) return;
      const current = get(tid);
      const { entries, slots } = current;
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
      const existing = slots[slotId] ?? { variants: [tail], active: 0 };
      const variants = [...existing.variants];
      variants[existing.active] = tail;
      variants.push([]); // the edited version: filled in when it is switched away from
      // Not kept yet: ``send`` keeps it with the question, and an edit of the first question
      // must not leave the thread empty in between (that removes it, with its name and pin).
      commit(
        tid,
        {
          ...current,
          entries: entries.slice(0, at),
          slots: {
            ...slots,
            [slotId]: {
              variants,
              active: variants.length - 1,
              pending: existing.active,
            },
          },
        },
        false,
      );
      // The edited question keeps the files the first version was sent with.
      void send(
        text,
        slotId,
        first.role === "user" ? first.files : undefined,
        tid,
      );
    },
    [commit, get, send],
  );

  /** Show another version of an edited question, with what followed it. */
  const switchVersion = useCallback(
    (slotId: string, delta: -1 | 1) => {
      const tid = activeRef.current;
      if (controllersRef.current.has(tid)) return;
      const current = get(tid);
      const { entries, slots } = current;
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
      commit(tid, {
        ...current,
        entries: [...entries.slice(0, at), ...variants[target]],
        slots: { ...slots, [slotId]: { variants, active: target } },
      });
    },
    [commit, get],
  );

  /**
   * Give up on the reply being written in the thread shown. The question stays, with what was
   * written of the reply and a note that it was cancelled; asking again is one press away.
   */
  const stop = useCallback((): void => {
    const tid = activeRef.current;
    const controller = controllersRef.current.get(tid);
    if (!controller) return;
    controller.abort();
    controllersRef.current.delete(tid);
    syncRunning();
    const { entries } = get(tid);
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    // A reply is only ever under way as the last of a question and its reply, so the guard
    // below cannot trigger; it is there so a broken state is left alone rather than cut into.
    /* v8 ignore next 3 -- @preserve */
    if (last?.role !== "assistant" || last.status !== "streaming") return;
    patchAssistant(tid, last.id, () => ({
      status: "cancelled",
      searching: undefined,
    }));
    // A cancelled edit stays too, next to the version it was made from.
    settle(tid, asked?.role === "user" ? asked.slot : undefined);
  }, [get, patchAssistant, settle, syncRunning]);

  /** Ask the last question again, after a reply that failed or was cancelled. */
  const retry = useCallback(() => {
    const tid = activeRef.current;
    const current = get(tid);
    const { entries } = current;
    const last = entries[entries.length - 1];
    const asked = entries[entries.length - 2];
    if (
      last?.role !== "assistant" ||
      (last.status !== "error" && last.status !== "cancelled") ||
      asked?.role !== "user"
    ) {
      return;
    }
    // Not kept on its own, as in ``edit``.
    commit(tid, { ...current, entries: entries.slice(0, -2) }, false);
    void send(asked.content, asked.slot, asked.files, tid);
  }, [commit, get, send]);

  /**
   * Answer a question again. It is an edit that changes nothing: the earlier reply, with what
   * followed it, is kept as a version to go back to, and the new reply becomes the latest.
   * Unlike ``retry`` this works for any question, not only after a failure.
   */
  const regenerate = useCallback(
    (id: string) => {
      const asked = get(activeRef.current).entries.find(
        (entry) => entry.id === id,
      );
      if (asked?.role === "user") edit(id, asked.content);
    },
    [edit, get],
  );

  /** The person confirmed a proposed plan: run its steps, showing each as it ends. */
  const runPlan = useCallback(
    async (id: string, lang: string): Promise<boolean> => {
      const tid = activeRef.current;
      const found = get(tid).entries.find(
        (entry) => entry.id === id && entry.role === "assistant",
      ) as Assistant | undefined;
      if (!found?.plan || found.plan.status !== "pending") return false;
      patchAssistant(tid, id, (entry) => ({
        plan: { ...entry.plan!, status: "running", results: [] },
      }));
      try {
        const ok = await executePlan(found.plan.steps, {
          lang,
          onStep: (step) =>
            patchAssistant(tid, id, (entry) => ({
              plan: { ...entry.plan!, results: [...entry.plan!.results, step] },
            })),
        });
        patchAssistant(tid, id, (entry) => ({
          plan: { ...entry.plan!, status: ok ? "done" : "failed" },
        }));
        return ok;
      } catch (error) {
        patchAssistant(tid, id, (entry) => ({
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
    [get, patchAssistant],
  );

  /** The person decided not to run the plan. */
  const cancelPlan = useCallback(
    (id: string) =>
      patchAssistant(activeRef.current, id, (entry) =>
        entry.plan?.status === "pending"
          ? { plan: { ...entry.plan, status: "cancelled" } }
          : {},
      ),
    [patchAssistant],
  );

  /** Empty a thread (the one shown, unless another is named), stopping any reply under way. */
  const clear = useCallback(
    (target?: string) => {
      const tid = target ?? activeRef.current;
      controllersRef.current.get(tid)?.abort();
      controllersRef.current.delete(tid);
      syncRunning();
      commit(tid, EMPTY_CHAT);
    },
    [commit, syncRunning],
  );

  /** Forget a thread that was removed: a reply under way in it stops, and nothing is kept again. */
  const forget = useCallback(
    (tid: string) => {
      controllersRef.current.get(tid)?.abort();
      controllersRef.current.delete(tid);
      threadsRef.current.delete(tid);
      syncRunning();
      if (tid === activeRef.current) setState(EMPTY_CHAT);
    },
    [syncRunning],
  );

  /** Carry on from a question that was answered in the search box, in the thread named. */
  const adopt = useCallback(
    (question: string, result: AnswerResult, target?: string) => {
      const tid = target ?? activeRef.current;
      if (controllersRef.current.has(tid)) return;
      const current = get(tid);
      commit(tid, {
        ...current,
        entries: [
          ...current.entries,
          { id: newId(), role: "user", content: question },
          {
            id: newId(),
            role: "assistant",
            ...(finished(result) as Omit<Assistant, "id" | "role">),
          } as Assistant,
        ],
      });
    },
    [commit, get],
  );

  return {
    entries: state.entries,
    slots: state.slots,
    compact: summaryFor(state),
    loaded,
    busy,
    running,
    unread,
    send,
    queue: state.queue ?? NOTHING_WAITING,
    ask,
    unqueue,
    resume,
    edit,
    switchVersion,
    stop,
    retry,
    regenerate,
    runPlan,
    cancelPlan,
    clear,
    forget,
    adopt,
  };
}
