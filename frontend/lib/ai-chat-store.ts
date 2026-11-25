/**
 * The conversations with the assistant, kept in this browser: a list of threads per person and
 * one storage entry per thread, so writing one thread never rewrites the others.
 *
 *   wikihub:chat:v2:{userId}:index          -> { usedAt, active, threads: ThreadMeta[] }
 *   wikihub:chat:v2:{userId}:thread:{id}    -> { entries, slots, compact? }
 *   wikihub:chat:v2:{userId}:files:{id}     -> files waiting in a thread's question box
 *   wikihub:chat:v2:{userId}:draft:{id}     -> words typed there and not sent
 *
 * Everything but ``…:used`` and ``…:key`` is stored encrypted (see ``chat-vault``).
 * Nothing of it is on the server. Threads stay when the person signs out: each person reads only
 * their own namespace, and an administrator viewing as someone else keeps nothing (see
 * ``persist`` in the chat hook). When the browser's storage is full, the people who have not used
 * this browser for longest lose their threads first, then this person's oldest unpinned ones.
 */
import {
  CHAT_PREFIX,
  chatKey,
  chatStorage,
  draftKey,
  filesKey,
  NEW_BOX,
  EMPTY_CHAT,
  LEGACY_CHAT_PREFIX,
  parseChatState,
  storableChatState,
  type ChatState,
} from "@/lib/ai-chat";
import { isOpenName } from "@/lib/chat-vault";

/** Where a thread's name came from: its first question (for now), the assistant, or the person. */
export type ThreadTitleSource = "pending" | "ai" | "manual";

export type ThreadMeta = {
  id: string;
  title: string;
  titleSource: ThreadTitleSource;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

/**
 * The gist of the turns that no longer fit in what is sent with a question: sent before the
 * recent turns, so a long thread still remembers how it began.
 */
export type ThreadCompact = {
  summary: string;
  /** The id of the last turn the summary covers. */
  upTo: string;
  /** How many turns it covers, for the note shown in the thread. */
  count: number;
};

export type ThreadData = ChatState & { compact?: ThreadCompact };

type ChatIndex = {
  usedAt: number;
  active?: string;
  threads: ThreadMeta[];
};

/** Told when old threads of this person were removed to make room: ``{userId, titles}``. */
export const CHAT_DROPPED_EVENT = "wikihub:chat-dropped";

/** A guard against a runaway list; the browser's storage is the real limit. */
export const MAX_THREADS = 200;
/** How long a name taken from the first question is. */
export const PENDING_TITLE_CHARS = 60;

const indexKey = (userId: string) => chatKey(userId, "index");
const threadKey = (userId: string, id: string) => chatKey(userId, "thread", id);
const usedKey = (userId: string) => chatKey(userId, "used");

let counter = 0;
/** An id for a thread. Not ``crypto.randomUUID``: that does not exist on a page served over plain http. */
export function newThreadId(): string {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** A name for a thread from its first question, until a better one is found. */
export function pendingTitle(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= PENDING_TITLE_CHARS) return flat;
  const cut = flat.slice(0, PENDING_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > PENDING_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const storage = chatStorage;

/** Told in this tab when the list of threads changed (other tabs hear the ``storage`` event). */
export const CHAT_THREADS_EVENT = "wikihub:chat-threads";

function readJson(key: string): unknown {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const isMeta = (meta: unknown): meta is ThreadMeta =>
  !!meta &&
  typeof meta === "object" &&
  typeof (meta as ThreadMeta).id === "string" &&
  typeof (meta as ThreadMeta).title === "string" &&
  typeof (meta as ThreadMeta).createdAt === "number" &&
  typeof (meta as ThreadMeta).updatedAt === "number";

function readIndex(userId: string): ChatIndex {
  const parsed = readJson(indexKey(userId)) as Partial<ChatIndex> | null;
  const threads = Array.isArray(parsed?.threads)
    ? parsed.threads.filter(isMeta).map((meta) => ({
        ...meta,
        titleSource: (["pending", "ai", "manual"] as const).includes(
          meta.titleSource,
        )
          ? meta.titleSource
          : ("pending" as const),
      }))
    : [];
  return {
    usedAt: typeof parsed?.usedAt === "number" ? parsed.usedAt : 0,
    active: typeof parsed?.active === "string" ? parsed.active : undefined,
    threads,
  };
}

/** The person each kept key belongs to, and when they last used this browser. */
function namespaces(
  store: Storage,
): Map<string, { keys: string[]; usedAt: number }> {
  const found = new Map<string, { keys: string[]; usedAt: number }>();
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(CHAT_PREFIX)) continue;
    const userId = key.slice(CHAT_PREFIX.length).split(":")[0];
    const space = found.get(userId) ?? { keys: [], usedAt: 0 };
    space.keys.push(key);
    found.set(userId, space);
  }
  for (const [userId, space] of found) {
    // Another person's list cannot be opened; when they were last here is kept readable.
    space.usedAt =
      Number(store.getItem(usedKey(userId))) || readIndex(userId).usedAt;
  }
  return found;
}

/** Remove everything kept under a thread: what was said and what waits in its box. */
function removeThreadKeys(store: Storage, userId: string, id: string): void {
  store.removeItem(threadKey(userId, id));
  store.removeItem(filesKey(userId, id));
  store.removeItem(draftKey(userId, id));
}

// Removed to make room, told once the writing that needed the room is done.
const dropped: { userId: string; title: string }[] = [];

function tellDropped(userId: string, title: string): void {
  dropped.push({ userId, title });
  if (dropped.length > 1) return;
  queueMicrotask(() => {
    const gone = dropped.splice(0);
    for (const owner of new Set(gone.map((one) => one.userId))) {
      const titles = gone
        .filter((one) => one.userId === owner)
        .map((one) => one.title);
      window.dispatchEvent(
        new CustomEvent(CHAT_DROPPED_EVENT, {
          detail: { userId: owner, titles },
        }),
      );
    }
  });
}

/**
 * Make room after the browser refused a write: drop one thing, the least missed first. Returns
 * false when nothing more may go.
 */
function evictOne(userId: string, keep: string | undefined): boolean {
  const store = storage();
  if (!store) return false;
  // Someone else's threads, whoever has not used this browser for longest.
  const others = [...namespaces(store).entries()]
    .filter(([owner]) => owner !== userId)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  if (others.length) {
    for (const key of others[0][1].keys) store.removeItem(key);
    return true;
  }
  // Then what of this person was sealed with a key the server no longer gives: unreadable.
  const unreadable = (namespaces(store).get(userId)?.keys ?? []).filter(
    (key) => !isOpenName(key) && store.getItem(key) === null,
  );
  if (unreadable.length) {
    for (const key of unreadable) store.removeItem(key);
    return true;
  }
  // Then this person's oldest thread that is not pinned, and not the one being written.
  const index = readIndex(userId);
  const victim = [...index.threads]
    .filter((meta) => !meta.pinned && meta.id !== keep)
    .sort((a, b) => a.updatedAt - b.updatedAt)[0];
  if (!victim) return false;
  removeThreadKeys(store, userId, victim.id);
  tellDropped(userId, victim.title);
  writeIndex(userId, {
    ...index,
    threads: index.threads.filter((meta) => meta.id !== victim.id),
  });
  return true;
}

function write(
  userId: string,
  key: string,
  value: string,
  keep?: string,
): boolean {
  const store = storage();
  if (!store) return false;
  for (let attempt = 0; attempt < MAX_THREADS + 16; attempt += 1) {
    try {
      store.setItem(key, value);
      return true;
    } catch {
      if (!evictOne(userId, keep)) return false;
    }
  }
  /* v8 ignore start -- @preserve: there is never more to drop than that */
  return false;
}
/* v8 ignore stop -- @preserve */

function writeIndex(userId: string, index: ChatIndex): void {
  write(userId, indexKey(userId), JSON.stringify(index));
  if (index.usedAt) write(userId, usedKey(userId), String(index.usedAt));
  window.dispatchEvent(
    new CustomEvent(CHAT_THREADS_EVENT, { detail: { userId } }),
  );
}

function updateIndex(
  userId: string,
  change: (index: ChatIndex) => ChatIndex,
): void {
  writeIndex(userId, change(readIndex(userId)));
}

const byRecent = (a: ThreadMeta, b: ThreadMeta) =>
  Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt;

/** This person's threads: pinned first, then the most recently used. */
export function listThreads(userId: string): ThreadMeta[] {
  return [...readIndex(userId).threads].sort(byRecent);
}

/** The thread that was open last, if it still exists. */
export function activeThread(userId: string): string | undefined {
  const index = readIndex(userId);
  return index.threads.some((meta) => meta.id === index.active)
    ? index.active
    : undefined;
}

export function setActiveThread(userId: string, id: string | undefined): void {
  updateIndex(userId, (index) => ({
    ...index,
    active: id,
    usedAt: Date.now(),
  }));
}

/** A thread as it was kept; empty when there is none or it cannot be read. */
export function loadThread(userId: string, id: string): ThreadData {
  const parsed = readJson(threadKey(userId, id));
  const state = parseChatState(parsed);
  const compact = (parsed as { compact?: Partial<ThreadCompact> } | null)
    ?.compact;
  return compact &&
    typeof compact.summary === "string" &&
    typeof compact.upTo === "string" &&
    typeof compact.count === "number"
    ? { ...state, compact: compact as ThreadCompact }
    : state;
}

/**
 * Keep a thread. The first time it has a question it joins the list, named after that question;
 * it moves to the top only when what is kept changed. An empty thread is not kept.
 */
export function saveThread(userId: string, id: string, data: ThreadData): void {
  const store = storage();
  if (!store) return;
  const state = storableChatState(data);
  const key = threadKey(userId, id);
  if (state.entries.length === 0) {
    deleteThread(userId, id);
    return;
  }
  const value = JSON.stringify(
    data.compact ? { ...state, compact: data.compact } : state,
  );
  let previous: string | null = null;
  try {
    previous = store.getItem(key);
  } catch {
    // Unreadable: written again below.
  }
  const index = readIndex(userId);
  const known = index.threads.find((meta) => meta.id === id);
  if (previous === value && known) return;
  if (!write(userId, key, value, id)) return;

  const now = Date.now();
  const firstQuestion = state.entries.find((entry) => entry.role === "user");
  const asked = pendingTitle(firstQuestion?.content ?? "");
  const meta: ThreadMeta = known
    ? {
        ...known,
        // A name taken from the first question follows that question when it is edited.
        title: known.titleSource === "pending" && asked ? asked : known.title,
        updatedAt: now,
      }
    : {
        id,
        title: asked,
        titleSource: "pending",
        createdAt: now,
        updatedAt: now,
      };
  // Read again: making room may have dropped other threads from the list.
  const fresh = readIndex(userId);
  let threads = [meta, ...fresh.threads.filter((other) => other.id !== id)];
  if (threads.length > MAX_THREADS) {
    const oldest = threads
      .filter((other) => !other.pinned && other.id !== id)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, threads.length - MAX_THREADS);
    for (const gone of oldest) {
      removeThreadKeys(store, userId, gone.id);
      tellDropped(userId, gone.title);
    }
    threads = threads.filter((other) => !oldest.includes(other));
  }
  writeIndex(userId, { ...fresh, threads, usedAt: now });
}

/** Rename, pin or unpin a thread; the list order follows. */
export function updateThread(
  userId: string,
  id: string,
  patch: Partial<Pick<ThreadMeta, "title" | "titleSource" | "pinned">>,
): void {
  updateIndex(userId, (index) => ({
    ...index,
    threads: index.threads.map((meta) =>
      meta.id === id ? { ...meta, ...patch } : meta,
    ),
  }));
}

/** Remove a thread and everything kept of it. */
export function deleteThread(userId: string, id: string): void {
  const store = storage();
  if (!store) return;
  try {
    removeThreadKeys(store, userId, id);
  } catch {
    // Blocked storage: there is nothing to remove.
  }
  const index = readIndex(userId);
  if (!index.threads.some((meta) => meta.id === id) && index.active !== id) {
    return;
  }
  writeIndex(userId, {
    ...index,
    active: index.active === id ? undefined : index.active,
    threads: index.threads.filter((meta) => meta.id !== id),
  });
}

/**
 * The single conversation of the first version becomes this person's first thread, its files
 * the ones in the question box. Returns the new thread's id, if there was one.
 */
export function migrateLegacyChat(userId: string): string | undefined {
  const store = storage();
  if (!store) return undefined;
  const legacyKey = `${LEGACY_CHAT_PREFIX}${userId}`;
  const legacyFiles = `${LEGACY_CHAT_PREFIX}files:${userId}`;
  let migrated: string | undefined;
  try {
    const raw = store.getItem(legacyKey);
    if (raw) {
      const state = parseChatState(JSON.parse(raw));
      if (state.entries.length) {
        migrated = newThreadId();
        saveThread(userId, migrated, state);
      }
    }
  } catch {
    // An unreadable conversation is not worth carrying over.
  }
  try {
    const files = store.getItem(legacyFiles);
    const box = filesKey(userId, migrated ?? NEW_BOX);
    if (files && !store.getItem(box)) write(userId, box, files);
    store.removeItem(legacyKey);
    store.removeItem(legacyFiles);
  } catch {
    // Blocked storage: nothing was kept to move.
  }
  return migrated;
}

/**
 * Hear when another tab of this browser changes this person's threads. Returns the function
 * that stops listening.
 */
export function subscribeThreads(
  userId: string,
  onChange: (key: string) => void,
): () => void {
  const listener = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === indexKey(userId) ||
      event.key.startsWith(threadKey(userId, ""))
    ) {
      onChange(event.key ?? "");
    }
  };
  const local = (event: Event) => {
    if ((event as CustomEvent<{ userId: string }>).detail?.userId === userId) {
      onChange(indexKey(userId));
    }
  };
  window.addEventListener("storage", listener);
  window.addEventListener(CHAT_THREADS_EVENT, local);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHAT_THREADS_EVENT, local);
  };
}

export { threadKey as chatThreadKey, indexKey as chatIndexKey, EMPTY_CHAT };

// ------------------------------------------------------------ finding a thread

/** Words compared without case or Vietnamese marks: "cai dat" finds "Cài đặt". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export type ThreadMatch = {
  meta: ThreadMeta;
  /** Where in the thread the words were found; none when only its name matched. */
  entryId?: string;
  /** The words around what was found, to show under the name. */
  snippet?: string;
  /** Where the words are in the snippet, to mark them. */
  at?: [number, number];
};

const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 110;

/**
 * Where ``needle`` (already folded) is in ``text``, compared folded, as start and end in
 * ``text`` itself; null when it is not there.
 */
export function findFolded(
  text: string,
  needle: string,
): [number, number] | null {
  // Folding may drop marks, so keep where each folded character came from.
  const from: number[] = [];
  let folded = "";
  for (let index = 0; index < text.length; index += 1) {
    const piece = foldText(text[index]);
    for (let k = 0; k < piece.length; k += 1) from.push(index);
    folded += piece;
  }
  const found = folded.indexOf(needle);
  if (found < 0 || !needle) return null;
  return [from[found], from[found + needle.length - 1] + 1];
}

/** The words around what was found, with where it is in them. */
function snippetOf(
  content: string,
  needle: string,
): Pick<ThreadMatch, "snippet" | "at"> | null {
  const flat = content.replace(/\s+/g, " ").trim();
  const range = findFolded(flat, needle);
  if (!range) return null;
  const start = Math.max(range[0] - SNIPPET_BEFORE, 0);
  const end = Math.max(start + SNIPPET_LENGTH, range[1]);
  const lead = start > 0 ? "…" : "";
  return {
    snippet: `${lead}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`,
    at: [range[0] - start + lead.length, range[1] - start + lead.length],
  };
}

/**
 * This person's threads whose name or words hold the query: names first, then the most
 * recent. Everything is read in this browser; nothing is sent.
 */
export function searchThreads(
  userId: string,
  query: string,
  limit = 50,
): ThreadMatch[] {
  const needle = foldText(query.replace(/\s+/g, " ").trim());
  if (!needle) return [];
  const named: ThreadMatch[] = [];
  const said: ThreadMatch[] = [];
  for (const meta of listThreads(userId)) {
    if (foldText(meta.title).includes(needle)) {
      named.push({ meta });
      continue;
    }
    for (const entry of loadThread(userId, meta.id).entries) {
      const found = snippetOf(entry.content, needle);
      if (!found) continue;
      said.push({ meta, entryId: entry.id, ...found });
      break;
    }
  }
  return [...named, ...said].slice(0, limit);
}
