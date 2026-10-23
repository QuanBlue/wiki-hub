import { api, ApiError } from "@/lib/api-client";
import { apiBaseUrl } from "@/lib/env";
import type {
  AnswerAction,
  AnswerPlan,
  AnswerPlanStep,
  AnswerResult,
  AnswerSource,
  FileSource,
  WebSource,
} from "@/lib/ai-answer";

/** How much the person wants in an answer: the gist, the usual, or everything relevant. */
export type ChatDetail = "brief" | "normal" | "detailed";
export const CHAT_DETAILS: readonly ChatDetail[] = [
  "brief",
  "normal",
  "detailed",
];
const DETAIL_KEY = "wikihub:chat-detail";

/** The level last chosen in this browser; the usual one when none, or it cannot be read. */
export function readDetail(): ChatDetail {
  try {
    const stored = window.localStorage.getItem(DETAIL_KEY);
    return CHAT_DETAILS.includes(stored as ChatDetail)
      ? (stored as ChatDetail)
      : "normal";
  } catch {
    return "normal";
  }
}

export function saveDetail(detail: ChatDetail): void {
  try {
    window.localStorage.setItem(DETAIL_KEY, detail);
  } catch {
    // Private windows and full storage: the choice is just not kept.
  }
}

/** What the server accepts of one message, and of a whole conversation. */
export const CHAT_MAX_CHARS = 4000;
export const CHAT_MAX_MESSAGES = 20;
/** An earlier turn is sent cut to this: the question asked now is what needs the room. */
export const CHAT_HISTORY_CHARS = 2000;
/** Files a conversation may have attached from the person's computer. */
export const CHAT_MAX_FILES = 3;
/** What the server can read words from (``attachments.text.readable``). */
export const CHAT_FILE_TYPES =
  ".docx,.odt,.rtf,.epub,.html,.htm,.md,.markdown,.pdf,.xlsx,.csv,.txt,.text,.log";
/** The largest file the server reads, in bytes. */
export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** The most turns kept in the browser. */
const STORED_MAX = 30;
/**
 * How long a reply may go quiet before it is given up on. The server stops at 60 seconds in
 * all; this is for when nothing arrives at all (a dropped connection, a stalled proxy).
 */
export const CHAT_IDLE_TIMEOUT_MS = 75_000;

/** Why a reply did not come, as far as the person needs to tell: each has its own words. */
export type ChatFailure =
  | "timeout"
  | "unavailable"
  | "gateway"
  | "rate_limited"
  | "file_expired"
  | "error";

export class ChatStreamError extends Error {
  readonly failure: ChatFailure;
  /** For ``file_expired``: the attached file the server no longer has. */
  readonly fileId?: string;
  constructor(failure: ChatFailure, fileId?: string) {
    super(`The chat failed: ${failure}`);
    this.name = "ChatStreamError";
    this.failure = failure;
    this.fileId = fileId;
  }
}

/** What became of one step of a plan that was run. */
export type PlanStepResult = { ok: boolean; href?: string; error?: string };

/** A plan the assistant proposed, and where it stands: it runs only when the person confirms. */
export type PlanState = {
  steps: AnswerPlanStep[];
  skipped: AnswerPlan["skipped"];
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  results: PlanStepResult[];
};

/** One turn of the conversation as it is shown (and kept in the browser). */
export type ChatEntry =
  | {
      id: string;
      role: "user";
      content: string;
      /** Shared by every version of this question, once it has been edited. */
      slot?: string;
      /** Files attached with this question; read again by every question after it. */
      files?: AttachedFile[];
    }
  | {
      id: string;
      role: "assistant";
      /** The words so far while the reply is being written; the final answer once it is. */
      content: string;
      status: "streaming" | "done" | "error" | "cancelled";
      /** Set once done: whether the pages answer the question, and which pages. */
      found?: boolean;
      reason?: string;
      sources?: AnswerSource[];
      related?: AnswerSource[];
      /** What the answer stands on, and the internet pages it cites. */
      basis?: "wiki" | "web" | "general" | "clarify" | "app" | "plan";
      webSources?: WebSource[];
      /** The files attached in the chat that the answer cites. */
      fileSources?: FileSource[];
      /** Steps proposed, to confirm before they run. */
      plan?: PlanState;
      /** Buttons to the pages the answer is about. */
      actions?: AnswerAction[];
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
        content: entry.content.slice(0, CHAT_HISTORY_CHARS),
      });
    }
  }
  // The earlier questions are cut short too; only the one asked now is sent whole.
  for (let index = 0; index < sent.length - 1; index += 1) {
    sent[index].content = sent[index].content.slice(0, CHAT_HISTORY_CHARS);
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
  /** What was shown so far is dropped: a better way of answering is being taken. */
  | { type: "reset" }
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

/** Why a refused question was refused: an attached file that expired has its own words. */
async function refusalOf(response: Response): Promise<ChatStreamError> {
  if (response.status === 400) {
    try {
      const body = (await response.json()) as {
        error?: { code?: string; details?: { file_id?: unknown } };
      };
      if (body.error?.code === "chat_file_expired") {
        const fileId = body.error.details?.file_id;
        return new ChatStreamError(
          "file_expired",
          typeof fileId === "string" ? fileId : undefined,
        );
      }
    } catch {
      // Not the usual error body: the plain failure below.
    }
  }
  return new ChatStreamError(failureOf(response.status));
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
    onReset,
    detail = "normal",
    attachmentId = null,
    fileIds = [],
    idleTimeoutMs = CHAT_IDLE_TIMEOUT_MS,
  }: {
    signal?: AbortSignal;
    onStart?: (pages: number) => void;
    onDelta?: (text: string) => void;
    onSearching?: (query: string) => void;
    /** The words shown so far are to be dropped: the reply is being redone (a web search). */
    onReset?: () => void;
    /** How long and thorough the answer should be. */
    detail?: ChatDetail;
    /** Answer from this one attached file only ("Ask about this file"). */
    attachmentId?: string | null;
    /** Files attached in the chat (``uploadChatFile``): read together with the wiki. */
    fileIds?: string[];
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
        body: JSON.stringify({
          messages,
          detail,
          ...(attachmentId ? { attachment_id: attachmentId } : {}),
          ...(fileIds.length ? { file_ids: fileIds } : {}),
        }),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ChatStreamError("timeout");
      if (signal?.aborted) throw cause;
      throw new ChatStreamError("error");
    }

    if (!response.ok) {
      // A refusal before the stream starts (not signed in, quota, AI off, a file expired).
      throw await refusalOf(response);
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
          else if (event.type === "reset") onReset?.();
          else if (event.type === "done") return event.result;
          else if (event.type === "error") {
            // ``gateway``: a call to the AI failed or came back empty - asking again mends it.
            throw new ChatStreamError(
              event.code === "timeout" || event.code === "gateway"
                ? event.code
                : "unavailable",
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

// ------------------------------------------------------------ carrying out a plan

type PlanEvent =
  | { type: "step"; index: number; ok: boolean; href?: string; error?: string }
  | { type: "done"; ok: boolean };

/**
 * Run the steps of a confirmed plan, as the person. onStep hears of each step as it ends
 * (writing a page takes as long as the model does); the promise says whether all of them went
 * through. Rejects with ChatStreamError.
 */
export async function executePlan(
  steps: AnswerPlanStep[],
  {
    lang,
    signal,
    onStep,
    idleTimeoutMs = CHAT_IDLE_TIMEOUT_MS,
  }: {
    lang: string;
    signal?: AbortSignal;
    onStep?: (result: PlanStepResult) => void;
    idleTimeoutMs?: number;
  },
): Promise<boolean> {
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
  try {
    arm();
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}/api/v1/ai/chat/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          lang,
          steps: steps.map(({ type, args }) => ({ type, args })),
        }),
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      throw new ChatStreamError(timedOut ? "timeout" : "error");
    }
    if (!response.ok || !response.body) {
      throw new ChatStreamError(failureOf(response.status));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new ChatStreamError(timedOut ? "timeout" : "error");
        }
        if (chunk.done) break;
        arm();
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events as unknown as PlanEvent[]) {
          if (event.type === "step") {
            onStep?.({ ok: event.ok, href: event.href, error: event.error });
          } else if (event.type === "done") {
            return event.ok;
          }
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
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

const CHAT_KEY_PREFIX = "wikihub:chat:v1:";
const storageKey = (userId: string) => `${CHAT_KEY_PREFIX}${userId}`;
/** The files attached to the conversation: under the same prefix, so signing out clears them. */
const filesKey = (userId: string) => `${CHAT_KEY_PREFIX}files:${userId}`;

/** Set once the chats were wiped (signing out, changing account): nothing is written back. */
let wiped = false;

/**
 * Remove the conversations kept in this browser: everyone's, or everyone's but ``keep``'s.
 *
 * What people ask an assistant about their wiki can be sensitive, and it is kept here, in a
 * browser the next person may use. So it goes when the person signs out, when an
 * administrator starts or stops viewing as someone else, and - for any other way a session
 * ends (it expired, the window was just closed) - the next time a chat opens, which removes
 * every conversation but its own owner's. Wiping everything also stops later writes (a reply
 * still arriving must not bring the chat back) until a conversation is loaded again.
 * Preferences (width, level of detail) hold nothing of what was asked and stay.
 */
export function clearStoredChats(keep?: string): void {
  try {
    const store = window.localStorage;
    const spared = keep === undefined ? [] : [storageKey(keep), filesKey(keep)];
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(CHAT_KEY_PREFIX) && !spared.includes(key)) {
        store.removeItem(key);
      }
    }
  } catch {
    // Private windows and blocked storage: there is nothing kept to remove.
  }
  if (keep === undefined) wiped = true;
}

const isEntry = (entry: unknown): entry is ChatEntry =>
  !!entry &&
  typeof entry === "object" &&
  typeof (entry as ChatEntry).id === "string" &&
  typeof (entry as ChatEntry).content === "string" &&
  ((entry as ChatEntry).role === "user" ||
    (entry as ChatEntry).role === "assistant");

// A reply that was still being written when the page closed is not a reply; and a plan that was
// running is no longer known to be (it may have finished on the server: look before asking again).
const settled = (entry: ChatEntry): ChatEntry => {
  if (entry.role !== "assistant") return entry;
  if (entry.status === "streaming") {
    return { ...entry, status: "error" as const, failure: "error" as const };
  }
  if (entry.plan?.status === "running") {
    return { ...entry, plan: { ...entry.plan, status: "failed" as const } };
  }
  return entry;
};

/** The conversation kept in this browser for this person; empty when there is none or it is unreadable. */
export function loadChat(userId: string): ChatState {
  wiped = false;
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
  if (wiped) return;
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

// ------------------------------------------------------------ files attached in the chat

/** A file from the person's computer whose words the server keeps for a day. */
export type AttachedFile = {
  id: string;
  filename: string;
  /** The server no longer has its words (a day without a question): shown, not sent. */
  expired?: boolean;
};

/**
 * The files attached in this conversation, in the order they were sent, each once: every
 * question reads all of them, not only the files sent with it.
 */
export function conversationFiles(entries: ChatEntry[]): AttachedFile[] {
  const seen = new Map<string, AttachedFile>();
  for (const entry of entries) {
    if (entry.role !== "user") continue;
    for (const file of entry.files ?? []) {
      if (!seen.has(file.id)) seen.set(file.id, file);
    }
  }
  return [...seen.values()];
}

/** Why a file could not be attached: the server's code, and its words when it gave any. */
export class ChatFileError extends Error {
  readonly code: string;
  constructor(code: string, message = "") {
    super(message || code);
    this.name = "ChatFileError";
    this.code = code;
  }
}

/** Send a file to be read. Only its words are kept, for this person, for a day. */
export async function uploadChatFile(file: File): Promise<AttachedFile> {
  if (file.size > CHAT_FILE_MAX_BYTES) throw new ChatFileError("too_large");
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    const read = await api.post<{ id: string; filename: string }>(
      "/api/v1/ai/chat/files",
      undefined,
      { rawBody: form },
    );
    return { id: read.id, filename: read.filename };
  } catch (error) {
    if (!(error instanceof ApiError)) throw new ChatFileError("error");
    if (error.status === 413) throw new ChatFileError("too_large");
    if (error.status === 429) throw new ChatFileError("rate_limited");
    if (error.status === 503) throw new ChatFileError("unavailable");
    throw new ChatFileError(error.code, error.message);
  }
}

/** The files attached to this person's conversation in this browser. */
export function loadAttached(userId: string): AttachedFile[] {
  try {
    const raw = window.localStorage.getItem(filesKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (file): file is AttachedFile =>
          !!file &&
          typeof file === "object" &&
          typeof (file as AttachedFile).id === "string" &&
          typeof (file as AttachedFile).filename === "string",
      )
      .slice(0, CHAT_MAX_FILES);
  } catch {
    return [];
  }
}

export function saveAttached(userId: string, files: AttachedFile[]): void {
  try {
    if (files.length) {
      window.localStorage.setItem(filesKey(userId), JSON.stringify(files));
    } else {
      window.localStorage.removeItem(filesKey(userId));
    }
  } catch {
    // Private windows and full storage: the files are just not remembered.
  }
}

// ------------------------------------------------------------ opening the chat from elsewhere

export const CHAT_OPEN_EVENT = "wikihub:chat-open";
export const CHAT_TOGGLE_EVENT = "wikihub:chat-toggle";

/** A file attached to a page that the chat answers from alone, like a notebook's source. */
export type ChatFile = { id: string; filename: string };

export type ChatOpenDetail = {
  /** A question already answered elsewhere (the search box), to carry on from. */
  question?: string;
  result?: AnswerResult;
  /** Ask about this one file ("Ask about this file" on an attachment). */
  file?: ChatFile;
};

/** Open the chat panel, optionally continuing a question that was answered in the search box. */
export function openChat(detail: ChatOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
}

/** Open the chat panel if it is closed, close it if it is open (the top bar button). */
export function toggleChat(): void {
  window.dispatchEvent(new CustomEvent(CHAT_TOGGLE_EVENT));
}
