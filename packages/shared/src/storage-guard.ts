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
 * element is text, as it is for IRIS. The scanner approximates IRIS's parser: in a few hand-written
 * forms (a brace hidden in embedded SQL or HTML, for example) the two diverge, and then the guard
 * can miss a drop, or refuse a write that keeps every definition (the override still applies).
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
 * The names in `currentNames` that `keptNames` lacks: the one rule every Storage-drop comparison uses.
 *
 * Names are compared exactly (case-sensitive), so a rename is a drop; a name that appears twice in
 * `currentNames` is reported once.
 *
 * @param currentNames - The Storage definition names of the class as it is now.
 * @param keptNames - The Storage definition names of the text that would replace it.
 * @returns The dropped names, in the order of `currentNames`; empty when nothing is dropped.
 */
export function droppedStorageNames(
  currentNames: readonly string[],
  keptNames: readonly string[],
): string[] {
  const kept = new Set(keptNames);
  const dropped: string[] = [];
  for (const name of currentNames) {
    if (!kept.has(name) && !dropped.includes(name)) dropped.push(name);
  }
  return dropped;
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
  return droppedStorageNames(storageDefinitionNames(current), storageDefinitionNames(proposed));
}

/** The names of the Storage definitions inside quotes: `the Storage definition 'A'` or `the Storage definitions 'A', 'B'`. */
function definitionsPhrase(dropped: readonly string[]): string {
  const quoted = dropped.map((definition) => `'${definition}'`).join(", ");
  return dropped.length === 1 ? `the Storage definition ${quoted}` : `the Storage definitions ${quoted}`;
}

/**
 * The text of the refusal for a single document whose write drops Storage definitions:
 * `Document '<name>' was not saved in namespace '<namespace>': the content drops <the Storage
 * definition 'A' | the Storage definitions 'A', 'B'> that the class has now, and IRIS would generate
 * new storage at the next compile, which can change how existing rows are read. Nothing was stored.
 * <remedy>`.
 *
 * @param name - The document name.
 * @param namespace - The namespace the write targeted.
 * @param dropped - The dropped names, at least one (see {@link droppedStorageDefinitions}).
 * @param remedy - The closing sentence: what the caller can do about it.
 */
export function storageDroppedText(
  name: string,
  namespace: string,
  dropped: readonly string[],
  remedy: string,
): string {
  return (
    `Document '${name}' was not saved in namespace '${namespace}': the content drops ${definitionsPhrase(dropped)} ` +
    "that the class has now, and IRIS would generate new storage at the next compile, " +
    "which can change how existing rows are read. Nothing was stored. " +
    remedy
  );
}

/**
 * The refusal for a write that drops Storage definitions: `STORAGE_DROPPED`, `isError: true`, and
 * nothing stored. The text is {@link storageDroppedText}.
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
  return refusalResult(REFUSAL_CODES.STORAGE_DROPPED, storageDroppedText(name, namespace, dropped, remedy), {
    name,
    namespace,
    ...storageDroppedDetail(dropped),
  });
}

/** The fields of one dropped-Storage failure: the catalog code and the dropped definition names. */
export interface StorageDroppedDetail {
  code: typeof REFUSAL_CODES.STORAGE_DROPPED;
  droppedStorage: string[];
}

/**
 * The fields that mark one document's failure as a dropped-Storage refusal.
 *
 * @param dropped - The dropped names, at least one.
 * @returns `{code: STORAGE_DROPPED, droppedStorage}`, with a copy of `dropped`.
 */
export function storageDroppedDetail(dropped: readonly string[]): StorageDroppedDetail {
  return { code: REFUSAL_CODES.STORAGE_DROPPED, droppedStorage: [...dropped] };
}

/** The Storage definitions one document's write drops. */
export interface StorageDrop {
  /** The document name, such as `Pkg.A.cls`. */
  name: string;
  /** The dropped definition names, at least one. */
  droppedStorage: string[];
}

/**
 * One document's drops, as a result entry.
 *
 * @param name - The document name.
 * @param dropped - The dropped names, at least one.
 * @returns `{name, droppedStorage}`, with a copy of `dropped`.
 */
export function storageDrop(name: string, dropped: readonly string[]): StorageDrop {
  return { name, droppedStorage: [...dropped] };
}

/**
 * The drops as one line of prose: `Pkg.A.cls ('Default'); Pkg.B.cls ('Default', 'Alt')`.
 *
 * @param drops - The drops, in the order to list them.
 * @param limit - When given, only the first `limit` documents are listed and the rest become
 *   `; and N more`.
 */
export function describeStorageDrops(drops: readonly StorageDrop[], limit?: number): string {
  const shown = limit === undefined ? drops : drops.slice(0, limit);
  const listed = shown
    .map((drop) => `${drop.name} (${drop.droppedStorage.map((definition) => `'${definition}'`).join(", ")})`)
    .join("; ");
  const hidden = drops.length - shown.length;
  return hidden > 0 ? `${listed}; and ${hidden} more` : listed;
}

/**
 * The refusal for a write that would drop Storage definitions from one or more documents at once:
 * `STORAGE_DROPPED`, `isError: true`, and nothing stored.
 *
 * The text is `<opening>: it drops <list> that <the class has | the classes have> now, and IRIS would
 * generate new storage at the next compile, which can change how existing rows are read. <remedy>`,
 * where `<list>` is each drop as `the Storage definition 'A' of 'Pkg.X.cls'` (or `the Storage
 * definitions 'A', 'B' of 'Pkg.X.cls'`), joined by `; `. `structuredContent` is
 * `{code, ...fields, storageDrops}`.
 *
 * @param opening - What was not done, without a closing period.
 * @param drops - The drops, at least one.
 * @param remedy - The closing sentence: what the caller can do about it.
 * @param fields - The fields placed between `code` and `storageDrops`.
 */
export function storageDropsRefusal(
  opening: string,
  drops: readonly StorageDrop[],
  remedy: string,
  fields: Record<string, unknown> = {},
): RefusalResult {
  const list = drops.map((drop) => `${definitionsPhrase(drop.droppedStorage)} of '${drop.name}'`).join("; ");
  const owner = drops.length === 1 ? "the class has" : "the classes have";
  const text =
    `${opening}: it drops ${list} that ${owner} now, and IRIS would generate new storage at the next compile, ` +
    `which can change how existing rows are read. ${remedy}`;
  return refusalResult(REFUSAL_CODES.STORAGE_DROPPED, text, {
    ...fields,
    storageDrops: drops.map((drop) => storageDrop(drop.name, drop.droppedStorage)),
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

/**
 * Call `visit` with the text between `<` and `>` of every tag in `text`, in source order. Comments and
 * CDATA sections are skipped, and an unterminated one (or tag) ends the scan.
 */
function scanXmlTags(text: string, visit: (tag: string) => void): void {
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
    visit(text.slice(open + 1, close));
    i = close + 1;
  }
}

/** The attribute text after the element name when `tag` opens `element` (`Storage name="Default"`), else `undefined`. */
function openingAttributes(tag: string, element: string): string | undefined {
  if (!tag.startsWith(element)) return undefined;
  const attributes = tag.slice(element.length);
  return /^[\s/]/.test(attributes) ? attributes : undefined;
}

function xmlStorageNames(text: string): string[] {
  const names: string[] = [];
  scanXmlTags(text, (tag) => {
    const attributes = openingAttributes(tag, "Storage");
    if (attributes === undefined) return;
    const name = attributeValue(attributes, "name");
    if (name !== undefined) names.push(name);
  });
  return names;
}

/**
 * The Storage definition names of every `<Class>` in an XML export, by class name.
 *
 * The XML is an Atelier or `$SYSTEM.OBJ` export: `<Export>` holding `<Class name="Pkg.X">` elements,
 * each holding its `<Storage name="...">` elements. Names are listed in source order and compared
 * exactly. A `<Storage>` outside a `<Class>`, a comment or a CDATA section never counts, and an
 * element other than `Class` (a `<Routine>`, a `<Project>`) is not a class. A class with no
 * `<Storage>` maps to `[]`; a class named twice keeps the later element's names. One leading BOM
 * is ignored.
 *
 * @param lines - The XML text as the lines of an import's `content`.
 * @returns A map from class name (`Pkg.X`, without `.cls`) to its Storage names; empty when the
 *   text has no `<Class>`.
 */
export function xmlClassStorageNames(lines: readonly string[]): Map<string, string[]> {
  const classes = new Map<string, string[]>();
  let current: string[] | undefined;
  scanXmlTags(stripLeadingBomFromLines([...lines]).join("\n"), (tag) => {
    const classAttributes = openingAttributes(tag, "Class");
    if (classAttributes !== undefined) {
      const name = attributeValue(classAttributes, "name");
      current = undefined;
      if (name !== undefined && name !== "") {
        const names: string[] = [];
        classes.set(name, names);
        if (!classAttributes.trimEnd().endsWith("/")) current = names;
      }
      return;
    }
    if (/^\/Class\s*$/.test(tag)) {
      current = undefined;
      return;
    }
    if (current === undefined) return;
    const storageAttributes = openingAttributes(tag, "Storage");
    if (storageAttributes === undefined) return;
    const name = attributeValue(storageAttributes, "name");
    if (name !== undefined) current.push(name);
  });
  return classes;
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

/** Where the class body starts, and the class's `Language` keyword (lower case) when its header has one. */
interface ClassBody {
  /** The index just past the `{` that opens the class body. */
  start: number;
  language: string | undefined;
}

/** The language a `Language = <lang>` keyword names in keyword-list text, in lower case, or `undefined`. */
function keywordLanguage(keywords: string): string | undefined {
  return /\bLanguage\s*=\s*([A-Za-z0-9_]+)/i.exec(keywords)?.[1]?.toLowerCase();
}

/** What the string literal `text[open, end)` adds to keyword-list text: a quoted `Language` value, else `""`. */
function keywordString(keywords: string, text: string, open: number, end: number): string {
  return /Language\s*=\s*$/i.test(keywords) ? text.slice(open + 1, end - 1) : '""';
}

/** The class body's start and the class's language, or `undefined` when the text has no class header. */
function classBodyStart(text: string): ClassBody | undefined {
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
  return undefined;
}

/**
 * From inside the class header, the class body's start (just past its `{`) and the `Language` keyword
 * of the header's `[ ... ]` list, skipping comments, strings and the braces of a keyword value inside
 * that list (`[ Owner = {%Developer} ]`); `undefined` if the body never opens.
 */
function headerBraceEnd(text: string, from: number): ClassBody | undefined {
  let i = from;
  let listDepth = 0;
  let keywords = "";
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "{") {
      if (listDepth === 0) return { start: i + 1, language: keywordLanguage(keywords) };
      i = rawBodyEnd(text, i + 1);
    } else if (ch === '"') {
      const end = skipString(text, i);
      if (listDepth > 0) keywords += keywordString(keywords, text, i, end);
      i = end;
    } else if (ch === "/" && text[i + 1] === "/") {
      i = lineEnd(text, i);
    } else if (ch === "/" && text[i + 1] === "*") {
      i = blockCommentEnd(text, i);
    } else {
      if (ch === "[") listDepth += 1;
      else if (ch === "]" && listDepth > 0) listDepth -= 1;
      else if (listDepth > 0) keywords += ch;
      i += 1;
    }
  }
  return undefined;
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
 * The language of a method or trigger whose keyword list names none, as IRIS reads it: a client
 * method is JavaScript, a trigger is ObjectScript, and any other method takes the class's `Language`
 * keyword (ObjectScript when the class names none, `undefined` here).
 */
function defaultLanguage(keyword: string, classLanguage: string | undefined): string | undefined {
  if (keyword === "clientmethod") return "javascript";
  if (keyword === "trigger") return undefined;
  return classLanguage;
}

/**
 * Scan one class member that starts at `start`: its keyword, its declaration up to an unquoted `;` or
 * `{`, and its body. Records the name of a `Storage` member that has a body. Returns the index after it.
 */
function scanMember(text: string, start: number, names: string[], classLanguage: string | undefined): number {
  let i = start + 1;
  while (i < text.length && /[A-Za-z0-9]/.test(text[i] as string)) i += 1;
  const keyword = text.slice(start, i).toLowerCase();

  // The declaration, with string contents dropped, and the text of its `[ ... ]` keyword list (a quoted
  // Language value is kept there). A `{` inside the parentheses of a formal list (`target =
  // {$$$NULLOREF}`) or the keyword list (`SqlComputeCode = {...}`) is a value, not the member's body.
  let declaration = "";
  let keywords = "";
  let inKeywordList = false;
  let opensBody = false;
  let nesting = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"') {
      const end = skipString(text, i);
      if (inKeywordList) keywords += keywordString(keywords, text, i, end);
      declaration += '""';
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
      if (ch === "[" && nesting === 0) inKeywordList = true;
      if (ch === "(" || ch === "[") nesting += 1;
      else if ((ch === ")" || ch === "]") && nesting > 0) {
        nesting -= 1;
        if (nesting === 0) inKeywordList = false;
      }
      if (inKeywordList) keywords += ch;
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
    const language = keywordLanguage(keywords) ?? defaultLanguage(keyword, classLanguage);
    if (language === undefined || language === "objectscript" || language === "cache") {
      return objectScriptBodyEnd(text, i);
    }
    return foreignBodyEnd(text, i);
  }
  return rawBodyEnd(text, i);
}

function udlStorageNames(text: string): string[] {
  const names: string[] = [];
  const body = classBodyStart(text);
  if (body === undefined) return names;
  let i = body.start;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n") i += 1;
    else if (ch === "/" && text[i + 1] === "/") i = lineEnd(text, i);
    else if (ch === "/" && text[i + 1] === "*") i = blockCommentEnd(text, i);
    else if (ch === "}") break;
    else if (/[%A-Za-z]/.test(ch)) i = scanMember(text, i, names, body.language);
    else i += 1;
  }
  return names;
}
