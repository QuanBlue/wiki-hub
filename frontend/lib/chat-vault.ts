/**
 * The lock on what the browser keeps of the conversations. The key is the server's, given to a
 * signed-in person and held only in this page: after sign-out the browser holds nothing that
 * can be read, and signing in again opens it.
 *
 * Without a key there is no storage at all, so nothing can be written in the clear.
 */
import { isSealed, seal, unseal } from "@/lib/chat-seal";

/**
 * Every conversation kept in this browser lives under this prefix, one namespace per person:
 * ``wikihub:chat:v2:{userId}:index``, ``…:thread:{id}``, ``…:files:{id}`` and ``…:draft:{id}``.
 */
export const CHAT_PREFIX = "wikihub:chat:v2:";
export const chatKey = (userId: string, ...parts: string[]) =>
  `${CHAT_PREFIX}${userId}:${parts.join(":")}`;

/**
 * Kept readable: which key sealed a person's chats, and when they last used this browser
 * (someone else cannot open their list, yet must know whose to drop when storage is full).
 */
export const isOpenName = (name: string): boolean => /:(key|used)$/.test(name);

let secret: Uint8Array | null = null;
// What was opened already: the list is read often, and a search reads every thread.
const opened = new Map<string, { raw: string; text: string }>();

/** Hold the key (or let go of it). ``openChatVault`` also readies what is stored. */
export function setChatKey(key: Uint8Array | null): void {
  secret = key;
  opened.clear();
}

export const closeChatVault = (): void => setChatKey(null);

/**
 * The browser's storage seen through the key: written sealed, read opened. A value this key
 * does not open reads as absent. Null while there is no key.
 */
export function sealedStorage(raw: Storage): Storage | null {
  const key = secret;
  if (!key) return null;
  return {
    get length() {
      return raw.length;
    },
    key: (index) => raw.key(index),
    clear: () => raw.clear(),
    removeItem: (name) => {
      opened.delete(name);
      raw.removeItem(name);
    },
    getItem: (name) => {
      const value = raw.getItem(name);
      // Written before there was a lock; sealed the next time the vault opens.
      if (value === null || !isSealed(value)) return value;
      const known = opened.get(name);
      if (known?.raw === value) return known.text;
      const text = unseal(key, name, value);
      if (text !== null) opened.set(name, { raw: value, text });
      return text;
    },
    setItem: (name, text) => {
      if (isOpenName(name)) {
        raw.setItem(name, text);
        return;
      }
      const value = seal(key, name, text);
      raw.setItem(name, value);
      opened.set(name, { raw: value, text });
    },
  };
}

function move(raw: Storage, from: string, to: string): void {
  const value = raw.getItem(from);
  if (value === null) return;
  raw.setItem(to, value);
  raw.removeItem(from);
}

/**
 * The server's key changed: set the list written with the former one aside rather than write
 * over it, and take back the list this key wrote, so putting a key back brings its chats back.
 */
function switchLists(raw: Storage, userId: string, keyId: string): void {
  const marker = chatKey(userId, "key");
  const former = raw.getItem(marker);
  if (former && former !== keyId) {
    const index = chatKey(userId, "index");
    move(raw, index, `${index}@${former}`);
    move(raw, `${index}@${keyId}`, index);
  }
  raw.setItem(marker, keyId);
}

/** Seal what of this person was written before there was a lock. */
function sealWhatIsOpen(raw: Storage, userId: string): void {
  const store = sealedStorage(raw);
  if (!store) return;
  const mine = chatKey(userId, "");
  const names = Array.from({ length: raw.length }, (_, at) => raw.key(at));
  for (const name of names) {
    if (!name?.startsWith(mine) || isOpenName(name)) continue;
    const value = raw.getItem(name);
    if (value === null || isSealed(value)) continue;
    try {
      store.setItem(name, value);
    } catch {
      // No room: it stays as it was, and is still read.
    }
  }
}

/** Open this person's chats with their key. */
export function openChatVault(
  userId: string,
  key: Uint8Array,
  keyId: string,
): void {
  setChatKey(key);
  try {
    const raw = window.localStorage;
    switchLists(raw, userId, keyId);
    sealWhatIsOpen(raw, userId);
  } catch {
    // Blocked or full storage: nothing to ready.
  }
}
