/**
 * The Storage-drop guard shared by every tool that replaces a whole class's source.
 *
 * IRIS keeps a persistent class's Storage definitions (the map from properties to the globals that
 * hold the rows) in the class source. A write whose text has no Storage block makes IRIS drop the
 * class's definition, and the next compile generates a new one, which can change how existing rows
 * are read. The guard names the Storage definitions of the class as it is now and of the text that
 * would replace it, and reports the names the new text drops. Names are compared exactly
 * (case-sensitive): a rename is a drop, and a change to a definition's content is not.
 *
 * {@link storageDefinitionNames} reads a class's text, UDL or XML, without IRIS. It follows IRIS's own
 * parse, which a live oracle pins: only a `Storage <name>` member that is a direct member of the
 * class body counts, so a comment, a string, a method or XData body, or a label that merely says
 * `Storage` does not. Only a space and a tab are whitespace: a trailing carriage return inside an
 * element is text, as it is for IRIS. The scanner approximates IRIS's parser where the two can
 * diverge (an unbalanced quote or brace inside embedded SQL or HTML); on the proposed side a
 * divergence swallows members, so it fails safe (a refusal, with an override).
 */

import { stripLeadingBomFromLines } from "./lines.js";
import { REFUSAL_CODES, refusalResult, type RefusalResult } from "./refusals.js";

/** True when `name` is a class document (`Pkg.Name.cls`, the extension in any case). */
export function isClassDocument(name: string): boolean {
  return /\.cls$/i.test(name);
}

/**
 * The names of the Storage definitions in a class's text, in source order.
 *
 * The text is XML when its first non-blank element starts with `<` (the names are then the `name`
 * attributes of the `<Storage>` elements outside comments and CDATA sections), and UDL otherwise.
 * One leading BOM is ignored. Text with no class header yields `[]`.
 *
 * @param lines - The class text as the `content` array of an Atelier `/doc` request or result.
 * @returns The Storage definition names, possibly empty.
 */
export function storageDefinitionNames(lines: readonly string[]): string[] {
  const text = stripLeadingBomFromLines([...lines]).join("\n");
  return startsWithXml(text) ? xmlStorageNames(text) : udlStorageNames(text);
}

/**
 * The Storage definitions that `current` has and `proposed` lacks.
 *
 * @param current - The class text as it is now.
 * @param proposed - The class text that would replace it.
 * @returns The dropped names, in the order of `current`; empty when nothing is dropped.
 */
export function droppedStorageDefinitions(
  current: readonly string[],
  proposed: readonly string[],
): string[] {
  const kept = new Set(storageDefinitionNames(proposed));
  const dropped: string[] = [];
  for (const name of storageDefinitionNames(current)) {
    if (!kept.has(name) && !dropped.includes(name)) dropped.push(name);
  }
  return dropped;
}

/**
 * The refusal for a write that drops Storage definitions: `STORAGE_DROPPED`, `isError: true`, and
 * nothing stored.
 *
 * The text is `Document '<name>' was not saved in namespace '<namespace>': the content drops <the
 * Storage definition 'A' | the Storage definitions 'A', 'B'> that the class has now, and IRIS would
 * generate new storage at the next compile, which can change how existing rows are read. Nothing
 * was stored. <remedy>`.
 *
 * @param name - The document name.
 * @param namespace - The namespace the write targeted.
 * @param dropped - The dropped names, at least one (see {@link droppedStorageDefinitions}).
 * @param remedy - The closing sentence: what the caller can do about it.
 */
export function storageDroppedRefusal(
  name: string,
  namespace: string,
  dropped: readonly string[],
  remedy: string,
): RefusalResult {
  const quoted = dropped.map((definition) => `'${definition}'`).join(", ");
  const subject =
    dropped.length === 1 ? `the Storage definition ${quoted}` : `the Storage definitions ${quoted}`;
  const text =
    `Document '${name}' was not saved in namespace '${namespace}': the content drops ${subject} ` +
    "that the class has now, and IRIS would generate new storage at the next compile, " +
    "which can change how existing rows are read. Nothing was stored. " +
    remedy;
  return refusalResult(REFUSAL_CODES.STORAGE_DROPPED, text, {
    name,
    namespace,
    droppedStorage: [...dropped],
  });
}

// --- XML ---

function startsWithXml(text: string): boolean {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n")) i += 1;
  return text[i] === "<";
}

/** The index of the `>` that ends the tag opened at `open`, skipping quoted attribute values; -1 if none. */
function endOfTag(text: string, open: number): number {
  let quote: string | undefined;
  for (let i = open + 1; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/** The value of attribute `attribute` in the tag text after the element name, or `undefined`. */
function attributeValue(attributes: string, attribute: string): string | undefined {
  const pattern = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(attributes); match !== null; match = pattern.exec(attributes)) {
    if (match[1] === attribute) return match[2] ?? match[3];
  }
  return undefined;
}

function xmlStorageNames(text: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open < 0) break;
    if (text.startsWith("<!--", open)) {
      const close = text.indexOf("-->", open + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const close = text.indexOf("]]>", open + 9);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    const close = endOfTag(text, open);
    if (close < 0) break;
    const tag = text.slice(open + 1, close);
    if (tag.startsWith("Storage") && /^[\s/]/.test(tag.slice("Storage".length))) {
      const name = attributeValue(tag.slice("Storage".length), "name");
      if (name !== undefined) names.push(name);
    }
    i = close + 1;
  }
  return names;
}

// --- UDL ---

/** The index of the next `"\n"` at or after `from`, or the end of the text. */
function lineEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end < 0 ? text.length : end;
}

/** The index just past the end of the block comment opened at `open`, or the end of the text. */
function blockCommentEnd(text: string, open: number): number {
  const close = text.indexOf("*/", open + 2);
  return close < 0 ? text.length : close + 2;
}

/** The index just past the string literal opened at `open` (`""` is an escaped quote), or the end of the text. */
function skipString(text: string, open: number): number {
  let i = open + 1;
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** The index just past the `{` that opens the class body, or -1 when the text has no class header. */
function classBodyStart(text: string): number {
  let i = 0;
  while (i < text.length) {
    let word = i;
    while (text[word] === " " || text[word] === "\t") word += 1;
    if (text.startsWith("//", word)) {
      i = lineEnd(text, word) + 1;
    } else if (text.startsWith("/*", word)) {
      i = blockCommentEnd(text, word);
    } else if (
      text.slice(word, word + 5).toLowerCase() === "class" &&
      (text[word + 5] === " " || text[word + 5] === "\t")
    ) {
      return headerBraceEnd(text, word + 5);
    } else {
      i = lineEnd(text, word) + 1;
    }
  }
  return -1;
}

/**
 * From inside the class header, the index just past the `{` that opens the class body, skipping
 * comments, strings and the braces of a keyword value inside the `[ ... ]` list
 * (`[ Owner = {%Developer} ]`); -1 if none.
 */
function headerBraceEnd(text: string, from: number): number {
  let i = from;
  let listDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      if (listDepth === 0) return i + 1;
      i = rawBodyEnd(text, i + 1);
    } else if (ch === '"') {
      i = skipString(text, i);
    } else if (ch === "/" && text[i + 1] === "/") {
      i = lineEnd(text, i);
    } else if (ch === "/" && text[i + 1] === "*") {
      i = blockCommentEnd(text, i);
    } else {
      if (ch === "[") listDepth += 1;
      else if (ch === "]" && listDepth > 0) listDepth -= 1;
      i += 1;
    }
  }
  return -1;
}

/** The index just past the `}` that closes a body whose `{` is already consumed, counting braces only. */
function rawBodyEnd(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** As {@link rawBodyEnd}, ignoring braces in `"` strings, `//` and `;` comments (`;` covers `#;`) and block comments. */
function objectScriptBodyEnd(text: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') i = skipString(text, i);
    else if (ch === ";" || (ch === "/" && text[i + 1] === "/")) i = lineEnd(text, i);
    else if (ch === "/" && text[i + 1] === "*") i = blockCommentEnd(text, i);
    else {
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
  }
  return text.length;
}

/** The body of a method in another language ends at the first element that is `}` in column 0, then only spaces or tabs. */
function foreignBodyEnd(text: string, from: number): number {
  let end = lineEnd(text, from);
  while (end < text.length) {
    const start = end + 1;
    end = lineEnd(text, start);
    if (/^\}[ \t]*$/.test(text.slice(start, end))) return end;
  }
  return text.length;
}

const METHOD_KEYWORDS = new Set(["method", "classmethod", "clientmethod", "trigger"]);

/**
 * Scan one class member that starts at `start`: its keyword, its declaration up to an unquoted `;` or
 * `{`, and its body. Records the name of a `Storage` member that has a body. Returns the index after it.
 */
function scanMember(text: string, start: number, names: string[]): number {
  let i = start + 1;
  while (i < text.length && /[A-Za-z0-9]/.test(text[i] as string)) i += 1;
  const keyword = text.slice(start, i).toLowerCase();

  // The declaration, with string contents dropped (a quoted Language value is kept). A `{` inside
  // the parentheses of a formal list (`target = {$$$NULLOREF}`) or the `[ ... ]` keyword list
  // (`SqlComputeCode = {...}`) is a value, not the member's body.
  let declaration = "";
  let opensBody = false;
  let nesting = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') {
      const end = skipString(text, i);
      declaration += /Language\s*=\s*$/i.test(declaration) ? text.slice(i + 1, end - 1) : '""';
      i = end;
    } else if (ch === ";") {
      return i + 1;
    } else if (ch === "{" && nesting === 0) {
      opensBody = true;
      i += 1;
      break;
    } else if (ch === "{") {
      declaration += "{}";
      i = rawBodyEnd(text, i + 1);
    } else {
      if (ch === "(" || ch === "[") nesting += 1;
      else if ((ch === ")" || ch === "]") && nesting > 0) nesting -= 1;
      declaration += ch;
      i += 1;
    }
  }
  if (!opensBody) return text.length;

  if (keyword === "storage") {
    const name = /^[ \t\n]*([%A-Za-z][A-Za-z0-9]*)[ \t\n]*$/.exec(declaration)?.[1];
    if (name !== undefined) names.push(name);
    return rawBodyEnd(text, i);
  }
  if (METHOD_KEYWORDS.has(keyword)) {
    const language = /\bLanguage\s*=\s*([A-Za-z0-9_]+)/i.exec(declaration)?.[1]?.toLowerCase();
    if (language === undefined || language === "objectscript" || language === "cache") {
      return objectScriptBodyEnd(text, i);
    }
    return foreignBodyEnd(text, i);
  }
  return rawBodyEnd(text, i);
}

function udlStorageNames(text: string): string[] {
  const names: string[] = [];
  let i = classBodyStart(text);
  if (i < 0) return names;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n") i += 1;
    else if (ch === "/" && text[i + 1] === "/") i = lineEnd(text, i);
    else if (ch === "/" && text[i + 1] === "*") i = blockCommentEnd(text, i);
    else if (ch === "}") break;
    else if (/[%A-Za-z]/.test(ch)) i = scanMember(text, i, names);
    else i += 1;
  }
  return names;
}
