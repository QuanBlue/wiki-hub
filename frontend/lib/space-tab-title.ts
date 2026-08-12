/** A compact, ASCII-safe browser tab title derived from a space name. */
export function spaceTabTitle(name: string, fallbackKey: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim();

  return normalized || fallbackKey.toUpperCase();
}
