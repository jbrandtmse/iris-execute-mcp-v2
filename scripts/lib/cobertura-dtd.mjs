/**
 * A validator for Cobertura XML documents, for tests (Story 40.2, orchestrator decision #52).
 *
 * The coverage file `iris_test_status` writes names the published Cobertura DTD in its DOCTYPE, and a test must be able to
 * check a written file against that DTD's content model without fetching anything. This module therefore holds the model as
 * its own data ({@link COBERTURA_MODEL}): for each element, its children in sequence with their occurrence indicators, its
 * attributes with whether each is required, and whether it holds text. It copies no text, comment or notice from the DTD, and
 * no DTD file is vendored.
 *
 * Provenance of the model (the pinned copy it was encoded from, checked on the date below):
 *  - repository `cobertura/web`, file `htdocs/xml/coverage-04.dtd`
 *  - commit `f0366e5e2cf18f111cbd61fc34ef720a6584ba02` (2013-05-22), 2,030 bytes
 *  - sha256 `61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06`
 *  - URL {@link COBERTURA_DTD_SOURCE.url}
 *  - checked 2026-10-18 with `xmllint --noout --nonet --dtdvalid` against a download of that file (see the story's
 *    Verification), which agreed with this validator on a valid document and on a document with one `hits` attribute removed.
 *
 * The validator checks: well-formedness of the subset the writer produces, the declared DOCTYPE (root and system id), the root
 * element, declared elements only, required and undeclared attributes, each element's children against its sequence, and text
 * only where the model allows it.
 */

/** Where the model came from. */
export const COBERTURA_DTD_SOURCE = Object.freeze({
  repository: "cobertura/web",
  path: "htdocs/xml/coverage-04.dtd",
  commit: "f0366e5e2cf18f111cbd61fc34ef720a6584ba02",
  url: "https://raw.githubusercontent.com/cobertura/web/f0366e5e2cf18f111cbd61fc34ef720a6584ba02/htdocs/xml/coverage-04.dtd",
  sha256: "61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06",
  bytes: 2030,
  checked: "2026-10-18",
});

/** The system identifier the written document's DOCTYPE names (never fetched). */
export const COBERTURA_SYSTEM_ID = "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd";

const REQUIRED = "required";
const OPTIONAL = "optional";

const required = (...names) => Object.fromEntries(names.map((name) => [name, REQUIRED]));

/**
 * The content model. A child entry is `[name, occurrence]` with occurrence `"1"` (exactly one), `"?"` (at most one) or `"*"`
 * (any number); the children of an element appear in the order listed.
 */
export const COBERTURA_MODEL = Object.freeze({
  root: "coverage",
  elements: Object.freeze({
    coverage: {
      children: [["sources", "?"], ["packages", "1"]],
      text: false,
      attributes: required(
        "line-rate", "branch-rate", "lines-covered", "lines-valid", "branches-covered", "branches-valid",
        "complexity", "version", "timestamp",
      ),
    },
    sources: { children: [["source", "*"]], text: false, attributes: {} },
    source: { children: [], text: true, attributes: {} },
    packages: { children: [["package", "*"]], text: false, attributes: {} },
    package: {
      children: [["classes", "1"]],
      text: false,
      attributes: required("name", "line-rate", "branch-rate", "complexity"),
    },
    classes: { children: [["class", "*"]], text: false, attributes: {} },
    class: {
      children: [["methods", "1"], ["lines", "1"]],
      text: false,
      attributes: required("name", "filename", "line-rate", "branch-rate", "complexity"),
    },
    methods: { children: [["method", "*"]], text: false, attributes: {} },
    method: {
      children: [["lines", "1"]],
      text: false,
      attributes: required("name", "signature", "line-rate", "branch-rate"),
    },
    lines: { children: [["line", "*"]], text: false, attributes: {} },
    line: {
      children: [["conditions", "*"]],
      text: false,
      attributes: { number: REQUIRED, hits: REQUIRED, branch: OPTIONAL, "condition-coverage": OPTIONAL },
    },
    conditions: { children: [["condition", "*"]], text: false, attributes: {} },
    condition: { children: [], text: false, attributes: required("number", "type", "coverage") },
  }),
});

// -- A small XML reader, enough for the documents the writer produces --------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

class XmlSyntaxError extends Error {}

/** Decode the entity and character references of `raw`; an unknown entity is a syntax error. */
function decode(raw, where) {
  return raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (match, name) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    if (name in ENTITIES) return ENTITIES[name];
    throw new XmlSyntaxError(`unknown entity ${match} ${where}`);
  });
}

/**
 * Read an XML document: an optional XML declaration, an optional DOCTYPE with a system id, comments and one root element.
 *
 * @param {string} text - The document.
 * @returns {{declaration: string | null, doctype: {root: string, systemId: string | null} | null,
 *   root: {name: string, attributes: Record<string, string>, children: object[], text: string}}} The parsed document.
 * @throws {Error} When the document is not well formed.
 */
export function parseXml(text) {
  let position = 0;
  const fail = (message) => {
    throw new XmlSyntaxError(`${message} (offset ${position})`);
  };
  const skipSpace = () => {
    while (position < text.length && /\s/.test(text[position])) position++;
  };
  const startsWith = (prefix) => text.startsWith(prefix, position);
  const readName = () => {
    const match = /^[A-Za-z_][A-Za-z0-9._-]*/.exec(text.slice(position));
    if (!match) fail("a name was expected");
    position += match[0].length;
    return match[0];
  };
  const skipMisc = () => {
    for (;;) {
      skipSpace();
      if (startsWith("<!--")) {
        const end = text.indexOf("-->", position);
        if (end < 0) fail("an unterminated comment");
        position = end + 3;
      } else {
        return;
      }
    }
  };

  let declaration = null;
  if (startsWith("<?xml")) {
    const end = text.indexOf("?>", position);
    if (end < 0) fail("an unterminated XML declaration");
    declaration = text.slice(position, end + 2);
    position = end + 2;
  }
  skipMisc();

  let doctype = null;
  if (startsWith("<!DOCTYPE")) {
    position += "<!DOCTYPE".length;
    skipSpace();
    const root = readName();
    skipSpace();
    let systemId = null;
    if (startsWith("SYSTEM")) {
      position += "SYSTEM".length;
      skipSpace();
      const quote = text[position];
      if (quote !== '"' && quote !== "'") fail("a quoted system identifier was expected");
      const end = text.indexOf(quote, position + 1);
      if (end < 0) fail("an unterminated system identifier");
      systemId = text.slice(position + 1, end);
      position = end + 1;
      skipSpace();
    }
    if (text[position] !== ">") fail("the DOCTYPE must end with >");
    position++;
    doctype = { root, systemId };
  }
  skipMisc();

  const readElement = () => {
    if (text[position] !== "<") fail("an element was expected");
    position++;
    const name = readName();
    const attributes = {};
    for (;;) {
      skipSpace();
      if (startsWith("/>") || text[position] === ">") break;
      const attribute = readName();
      skipSpace();
      if (text[position] !== "=") fail(`the attribute ${attribute} needs =`);
      position++;
      skipSpace();
      const quote = text[position];
      if (quote !== '"' && quote !== "'") fail(`the value of ${attribute} must be quoted`);
      const end = text.indexOf(quote, position + 1);
      if (end < 0) fail(`the value of ${attribute} is not closed`);
      if (attribute in attributes) fail(`the attribute ${attribute} is repeated`);
      const raw = text.slice(position + 1, end);
      if (raw.includes("<")) fail(`the value of ${attribute} contains <`);
      attributes[attribute] = decode(raw, `in the value of ${attribute}`);
      position = end + 1;
    }
    const element = { name, attributes, children: [], text: "" };
    if (startsWith("/>")) {
      position += 2;
      return element;
    }
    position++;
    for (;;) {
      if (position >= text.length) fail(`the element ${name} is not closed`);
      if (startsWith("</")) {
        position += 2;
        const closing = readName();
        if (closing !== name) fail(`the end tag ${closing} does not match ${name}`);
        skipSpace();
        if (text[position] !== ">") fail("an end tag must end with >");
        position++;
        return element;
      }
      if (startsWith("<!--")) {
        const end = text.indexOf("-->", position);
        if (end < 0) fail("an unterminated comment");
        position = end + 3;
      } else if (startsWith("<![CDATA[") || startsWith("<?")) {
        fail("CDATA sections and processing instructions are not supported");
      } else if (text[position] === "<") {
        element.children.push(readElement());
      } else {
        const end = text.indexOf("<", position);
        if (end < 0) fail(`the element ${name} is not closed`);
        element.text += decode(text.slice(position, end), `in the text of ${name}`);
        position = end;
      }
    }
  };

  const root = readElement();
  skipMisc();
  if (position < text.length) fail("content after the root element");
  return { declaration, doctype, root };
}

// -- Validation -------------------------------------------------------------------------------------------------

/** Check `names` (the element names of the children, in order) against a sequence model. */
function sequenceProblems(path, model, names) {
  const problems = [];
  let index = 0;
  for (const [name, occurrence] of model) {
    let count = 0;
    while (index < names.length && names[index] === name && (occurrence === "*" || count < 1)) {
      count++;
      index++;
    }
    if (occurrence === "1" && count === 0) problems.push(`${path}: the required child <${name}> is missing or out of order`);
  }
  if (index < names.length) {
    problems.push(`${path}: the child <${names[index]}> (position ${index + 1}) is not allowed here or is out of order`);
  }
  return problems;
}

function elementProblems(element, path, model, problems) {
  const declared = model.elements[element.name];
  if (!declared) {
    problems.push(`${path}: the element <${element.name}> is not declared`);
    return;
  }
  for (const [attribute, use] of Object.entries(declared.attributes)) {
    if (use === REQUIRED && !(attribute in element.attributes)) {
      problems.push(`${path}: the required attribute ${attribute} is missing`);
    }
  }
  for (const attribute of Object.keys(element.attributes)) {
    if (!(attribute in declared.attributes)) problems.push(`${path}: the attribute ${attribute} is not declared`);
  }
  if (!declared.text && element.text.trim() !== "") {
    problems.push(`${path}: text is not allowed in <${element.name}>`);
  }
  problems.push(...sequenceProblems(path, declared.children, element.children.map((child) => child.name)));
  const seen = new Map();
  for (const child of element.children) {
    const number = (seen.get(child.name) ?? 0) + 1;
    seen.set(child.name, number);
    elementProblems(child, `${path}/${child.name}[${number}]`, model, problems);
  }
}

/**
 * Validate a Cobertura document against the encoded content model.
 *
 * @param {string} text - The document.
 * @returns {string[]} The problems found; empty when the document is valid.
 */
export function validateCobertura(text) {
  let parsed;
  try {
    parsed = parseXml(text);
  } catch (error) {
    return [`not well formed: ${error instanceof Error ? error.message : String(error)}`];
  }
  const problems = [];
  if (parsed.doctype === null) {
    problems.push("the document has no DOCTYPE");
  } else {
    if (parsed.doctype.root !== COBERTURA_MODEL.root) {
      problems.push(`the DOCTYPE declares the root ${parsed.doctype.root}, not ${COBERTURA_MODEL.root}`);
    }
    if (parsed.doctype.systemId !== COBERTURA_SYSTEM_ID) {
      problems.push(`the DOCTYPE names the system id ${parsed.doctype.systemId}, not ${COBERTURA_SYSTEM_ID}`);
    }
  }
  if (parsed.root.name !== COBERTURA_MODEL.root) {
    problems.push(`the root element is <${parsed.root.name}>, not <${COBERTURA_MODEL.root}>`);
  }
  elementProblems(parsed.root, parsed.root.name, COBERTURA_MODEL, problems);
  return problems;
}
