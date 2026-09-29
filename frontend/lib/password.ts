const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

function pick(characters: string): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return characters[values[0]! % characters.length]!;
}

/**
 * A random password that always has an upper-case letter, a lower-case letter
 * and a digit, and none of the look-alike characters (0/O, 1/l/I), so it is
 * typed correctly when read off a screen or an email.
 */
export function generatePassword(length = 16): string {
  const all = LOWER + UPPER + DIGITS;
  const characters = [
    pick(LOWER),
    pick(UPPER),
    pick(DIGITS),
    ...Array.from({ length: length - 3 }, () => pick(all)),
  ];
  // Fisher-Yates with a real source of randomness, so the guaranteed
  // characters are not always at the front.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const swap = values[0]! % (index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  return characters.join("");
}
