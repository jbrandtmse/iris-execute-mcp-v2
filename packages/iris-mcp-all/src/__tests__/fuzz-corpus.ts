/**
 * The random-text alphabet of the injection fuzzes that drive `iris_message_search` straight at its REST
 * route (Stories 39.3 and 39.4). It is shared so both gates attack with the same tokens: SQL quoting and
 * comment characters, the operators a hostile caller might try, collation and wildcard characters, control
 * characters, a non-ASCII letter, and a call of the side-effect function `Story393.Side_Bump()` whose
 * counter the gates read.
 */

/** The tokens `fuzzText` draws from. */
export const FUZZ_TOKENS = [
  "'", '"', "--", "/*", "*/", ";", "(", ")", ",", "?", "%", "_", "[", "]", "\\", " ", "\r", "\n", "\t", String.fromCodePoint(0xe9), "||",
  "=", "<>", "OR 1=1", "UNION SELECT", "Story393.Side_Bump()", "a", "Z", "0", "9", ".",
];

/**
 * Text made of 1 to 8 random tokens. With `marker`, that string is inserted at a random position, so a
 * response that echoes the text is detectable by searching for it.
 *
 * @param random - A seeded generator returning numbers in `[0, 1)`.
 * @param marker - Text to embed; omitted, none is.
 */
export function fuzzText(random: () => number, marker?: string): string {
  const parts: string[] = [];
  const count = 1 + Math.floor(random() * 8);
  for (let index = 0; index < count; index += 1) parts.push(FUZZ_TOKENS[Math.floor(random() * FUZZ_TOKENS.length)] as string);
  if (marker !== undefined) parts.splice(Math.floor(random() * (parts.length + 1)), 0, marker);
  return parts.join("");
}
