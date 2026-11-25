/**
 * Encryption of what the browser keeps of the conversations with the assistant:
 * XChaCha20-Poly1305 over the words, compressed first when that makes them smaller.
 *
 * A JavaScript cipher rather than ``crypto.subtle``: that does not exist on a page served over
 * plain http, and it only works asynchronously. ``crypto.getRandomValues`` exists everywhere.
 *
 * A sealed value is ``e1:`` + base64(nonce ‖ ciphertext of (flag ‖ bytes)). The name it is kept
 * under is authenticated with it, so a value moved to another name does not open.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { deflateSync, inflateSync } from "fflate";

const MARK = "e1:";
const NONCE_BYTES = 24;
const PLAIN = 0;
const DEFLATED = 1;
// ``String.fromCharCode`` takes only so many arguments at a time.
const CHUNK = 0x8000;

export const isSealed = (value: string): boolean => value.startsWith(MARK);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at);
  }
  return bytes;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

export function seal(key: Uint8Array, name: string, text: string): string {
  const bytes = utf8(text);
  const packed = deflateSync(bytes);
  const smaller = packed.length < bytes.length;
  const body = smaller ? packed : bytes;
  const flagged = new Uint8Array(body.length + 1);
  flagged[0] = smaller ? DEFLATED : PLAIN;
  flagged.set(body, 1);

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = xchacha20poly1305(key, nonce, utf8(name)).encrypt(flagged);
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce);
  out.set(sealed, nonce.length);
  return MARK + toBase64(out);
}

/** The words of a sealed value; null when this key and name do not open it. */
export function unseal(
  key: Uint8Array,
  name: string,
  value: string,
): string | null {
  if (!isSealed(value)) return null;
  try {
    const bytes = fromBase64(value.slice(MARK.length));
    const flagged = xchacha20poly1305(
      key,
      bytes.subarray(0, NONCE_BYTES),
      utf8(name),
    ).decrypt(bytes.subarray(NONCE_BYTES));
    const body = flagged.subarray(1);
    return new TextDecoder().decode(
      flagged[0] === DEFLATED ? inflateSync(body) : body,
    );
  } catch {
    return null;
  }
}
