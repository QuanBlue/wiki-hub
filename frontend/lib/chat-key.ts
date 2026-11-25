import { api } from "@/lib/api-client";
import { fromBase64 } from "@/lib/chat-seal";

export type ChatKey = { key: Uint8Array; keyId: string };

const KEY_BYTES = 32;

/** The signed-in person's key for the chats kept in this browser. Never kept itself. */
export async function fetchChatKey(): Promise<ChatKey> {
  const read = await api.get<{ key: string; key_id: string }>(
    "/api/v1/ai/chat/key",
  );
  const key = fromBase64(read.key);
  if (key.length !== KEY_BYTES || !read.key_id) {
    throw new Error("not a chat key");
  }
  return { key, keyId: read.key_id };
}
