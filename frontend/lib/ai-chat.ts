import { apiBaseUrl } from "@/lib/env";
import type { AnswerResult, AnswerSource, WebSource } from "@/lib/ai-answer";

/** What the server accepts of one message, and of a whole conversation. */
export const CHAT_MAX_CHARS = 2000;
export const CHAT_MAX_MESSAGES = 20;
/** The most turns kept in the browser. */
const STORED_MAX = 30;
/**
 * How long a reply may go quiet before it is given up on. The server stops at 60 seconds in
 * all; this is for when nothing arrives at all (a dropped connection, a stalled proxy).
 */
export const CHAT_IDLE_TIMEOUT_MS = 75_000;

/** Why a reply did not come, as far as the person needs to tell: each has its own words. */
export type ChatFailure = "timeout" | "unavailable" | "rate_limited" | "error";

export class ChatStreamError extends Error {
  readonly failure: ChatFailure;
  constructor(failure: ChatFailure) {
    super(`The chat failed: ${failure}`);
    this.name = "ChatStreamError";
    this.failure = failure;
  }
}

/** One turn of the conversation as it is shown (and kept in the browser). */
export type ChatEntry =
  | {
      id: string;
      role: "user";
      content: string;
      /** Shared by every version of this question, once it has been edited. */
      slot?: string;
    }
  | {
      id: string;
      role: "assistant";
      /** The words so far while the reply is being written; the final answer once it is. */
      content: string;
      status: "streaming" | "done" | "error";
      /** Set once done: whether the pages answer the question, and which pages. */
      found?: boolean;
      reason?: string;
      sources?: AnswerSource[];
      related?: AnswerSource[];
      /** What the answer stands on, and the internet pages it cites. */
      basis?: "wiki" | "web" | "general" | "clarify";
      webSources?: WebSource[];
      /** While it is being written: the web search that is under way. */
      searching?: string;
      failure?: ChatFailure;
    };

export type ChatSend = { role: "user" | "assistant"; content: string };

// ------------------------------------------------------------ what goes to the server

/**
 * The conversation as the server takes it: what the person asked, and the answers that were
 * given. A turn that failed or found nothing has no answer in it, so it is left out; the
 * question before it stays, because that is what the next one may refer to.
 */
export function messagesToSend(entries: ChatEntry[]): ChatSend[] {
  const sent: ChatSend[] = [];
  for (const entry of entries) {
    if (entry.role === "user") {
      sent.push({
        role: "user",
        content: entry.content.slice(0, CHAT_MAX_CHARS),
      });
    } else if (entry.status === "done" && entry.found && entry.content.trim()) {
      sent.push({
        role: "assistant",
        content: entry.content.slice(0, CHAT_MAX_CHARS),
      });
    }
  }
  const recent = sent.slice(-CHAT_MAX_MESSAGES);
  // The server wants the conversation to open with a question.
  while (recent.length > 1 && recent[0].role !== "user") recent.shift();
  return recent;
}

// ------------------------------------------------------------ reading the stream

export type ChatEvent =
  | { type: "start"; pages: number }
  | { type: "delta"; text: string }
  | { type: "searching"; query: string }
  | { type: "done"; result: AnswerResult }
  | { type: "error"; code: string };

/**
 * Take the complete server-sent events out of ``buffer``. What is left over (an event still
 * arriving) is returned to be joined with the next piece.
 */
export function parseEvents(buffer: string): {
  events: ChatEvent[];
  rest: string;
} {
  const events: ChatEvent[] = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const event = JSON.parse(data) as ChatEvent;
      if (event && typeof event === "object" && "type" in event) {
        events.push(event);
      }
    } catch {
      // A line that is not ours (a comment, a keep-alive) must not break the answer.
    }
  }
  return { events, rest };
}

function failureOf(status: number): ChatFailure {
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "error";
}

/**
 * Ask the next question of a conversation and read the reply as it arrives.
 *
 * ``onDelta`` gets each piece of the reply; the returned promise is the final result, whose
 * answer has had citations checked and secrets removed - it replaces what was streamed.
 * Rejects with {@link ChatStreamError}; aborting through ``signal`` rejects with an
 * ``AbortError``.
 */
export async function streamChat(
  messages: ChatSend[],
  {
    signal,
    onStart,
    onDelta,
    onSearching,
    idleTimeoutMs = CHAT_IDLE_TIMEOUT_MS,
  }: {
    signal?: AbortSignal;
    onStart?: (pages: number) => void;
    onDelta?: (text: string) => void;
    onSearching?: (query: string) => void;
    idleTimeoutMs?: number;
  } = {},
): Promise<AnswerResult> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) controller.abort();

  try {
    arm();
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/v1/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages }),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ChatStreamError("timeout");
      if (signal?.aborted) throw cause;
      throw new ChatStreamError("error");
    }

    if (!response.ok) {
      // A refusal before the stream starts (not signed in, quota, AI off).
      throw new ChatStreamError(failureOf(response.status));
    }
    if (!response.body) throw new ChatStreamError("error");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (cause) {
          if (timedOut) throw new ChatStreamError("timeout");
          if (signal?.aborted) throw cause;
          throw new ChatStreamError("error");
        }
        if (chunk.done) break;
        arm();
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          if (event.type === "start") onStart?.(event.pages);
          else if (event.type === "delta") onDelta?.(event.text);
          else if (event.type === "searching") onSearching?.(event.query);
          else if (event.type === "done") return event.result;
          else if (event.type === "error") {
            throw new ChatStreamError(
              event.code === "timeout" ? "timeout" : "unavailable",
            );
          }
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    // The stream ended without a result: the connection was cut.
    throw new ChatStreamError("error");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ------------------------------------------------------------ keeping the conversation

/**
 * A question that was edited has versions, each with what followed it: the question, its
 * answer and the turns after. The live conversation holds the version shown; the others wait
 * here until they are switched to.
 */
export type ChatSlot = {
  variants: ChatEntry[][];
  /** The version that is shown (the live conversation holds its latest state). */
  active: number;
  /** Set while an edited question is still being answered: the version to go back to on stop. */
  pending?: number;
};

export type ChatSlots = Record<string, ChatSlot>;
export type ChatState = { entries: ChatEntry[]; slots: ChatSlots };

export const EMPTY_CHAT: ChatState = { entries: [], slots: {} };

const storageKey = (userId: string) => `wikihub:chat:v1:${userId}`;

const isEntry = (entry: unknown): entry is ChatEntry =>
  !!entry &&
  typeof entry === "object" &&
  typeof (entry as ChatEntry).id === "string" &&
  typeof (entry as ChatEntry).content === "string" &&
  ((entry as ChatEntry).role === "user" ||
    (entry as ChatEntry).role === "assistant");

// A reply that was still being written when the page closed is not a reply.
const settled = (entry: ChatEntry): ChatEntry =>
  entry.role === "assistant" && entry.status === "streaming"
    ? { ...entry, status: "error" as const, failure: "error" as const }
    : entry;

/** The conversation kept in this browser for this person; empty when there is none or it is unreadable. */
export function loadChat(userId: string): ChatState {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY_CHAT;
    const parsed: unknown = JSON.parse(raw);
    // An earlier format was the list of turns alone.
    const stored = Array.isArray(parsed)
      ? { entries: parsed, slots: {} }
      : (parsed as { entries?: unknown; slots?: unknown });
    const entries = Array.isArray(stored.entries)
      ? stored.entries.filter(isEntry).map(settled)
      : [];
    const slots: ChatSlots = {};
    if (stored.slots && typeof stored.slots === "object") {
      for (const [id, slot] of Object.entries(
        stored.slots as Record<string, Partial<ChatSlot>>,
      )) {
        if (!slot || !Array.isArray(slot.variants)) continue;
        const variants = slot.variants.map((tail) =>
          Array.isArray(tail) ? tail.filter(isEntry).map(settled) : [],
        );
        const active = slot.active;
        if (
          variants.length > 1 &&
          typeof active === "number" &&
          active >= 0 &&
          active < variants.length
        ) {
          slots[id] = { variants, active };
        }
      }
    }
    return { entries, slots };
  } catch {
    return EMPTY_CHAT;
  }
}

const storable = (entries: ChatEntry[]) =>
  entries.filter(
    (entry) => entry.role === "user" || entry.status !== "streaming",
  );

export function saveChat(userId: string, state: ChatState): void {
  try {
    const entries = storable(state.entries).slice(-STORED_MAX);
    if (entries.length === 0) {
      window.localStorage.removeItem(storageKey(userId));
      return;
    }
    // Only the versions of questions that are still in the conversation are worth keeping.
    const shown = new Set(
      entries.flatMap((entry) =>
        entry.role === "user" && entry.slot ? [entry.slot] : [],
      ),
    );
    const slots: ChatSlots = {};
    for (const [id, slot] of Object.entries(state.slots)) {
      if (!shown.has(id) || slot.pending !== undefined) continue;
      slots[id] = {
        active: slot.active,
        variants: slot.variants.map((tail) =>
          storable(tail).slice(-STORED_MAX),
        ),
      };
    }
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify({ entries, slots }),
    );
  } catch {
    // Private windows and full storage: the conversation just is not kept.
  }
}

// ------------------------------------------------------------ opening the chat from elsewhere

export const CHAT_OPEN_EVENT = "wikihub:chat-open";
export const CHAT_TOGGLE_EVENT = "wikihub:chat-toggle";

export type ChatOpenDetail = {
  /** A question already answered elsewhere (the search box), to carry on from. */
  question?: string;
  result?: AnswerResult;
};

/** Open the chat panel, optionally continuing a question that was answered in the search box. */
export function openChat(detail: ChatOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
}

/** Open the chat panel if it is closed, close it if it is open (the top bar button). */
export function toggleChat(): void {
  window.dispatchEvent(new CustomEvent(CHAT_TOGGLE_EVENT));
}
