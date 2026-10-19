/**
 * Story 40.2 (decision #52) - the Cobertura validator `scripts/lib/cobertura-dtd.mjs`, held in the default suite.
 *
 * The validator encodes the content model of the pinned `coverage-04.dtd` as its own data (no DTD file is vendored). This test
 * pins that model against a list written by hand from a reading of the pinned file (so an edit of the encoded model alone
 * fails it), shows that a valid document passes, and shows that the validator goes red on each kind of damage it claims to
 * catch: a dropped required attribute, a misplaced child, an undeclared element and attribute, text in element content, and a
 * wrong or missing DOCTYPE. Cross-package scripts are checked here (Rule #45).
 */

import { describe, it, expect } from "vitest";
import {
  COBERTURA_DTD_SOURCE,
  COBERTURA_MODEL,
  COBERTURA_SYSTEM_ID,
  parseXml,
  validateCobertura,
} from "../../../../scripts/lib/cobertura-dtd.mjs";

/**
 * The model as hand-checked against the pinned DTD, one element per line:
 * `name | children (? at most one, * any number, no mark exactly one) | attributes (! required, ~ optional) | text`,
 * with `-` for none.
 */
const HAND_CHECKED_MODEL = [
  "coverage | sources?, packages | line-rate!, branch-rate!, lines-covered!, lines-valid!, branches-covered!, branches-valid!, complexity!, version!, timestamp! |",
  "sources | source* | - |",
  "source | - | - | text",
  "packages | package* | - |",
  "package | classes | name!, line-rate!, branch-rate!, complexity! |",
  "classes | class* | - |",
  "class | methods, lines | name!, filename!, line-rate!, branch-rate!, complexity! |",
  "methods | method* | - |",
  "method | lines | name!, signature!, line-rate!, branch-rate! |",
  "lines | line* | - |",
  "line | conditions* | number!, hits!, branch~, condition-coverage~ |",
  "conditions | condition* | - |",
  "condition | - | number!, type!, coverage! |",
];

/** The encoded model in the notation of {@link HAND_CHECKED_MODEL}. */
function describeModel(): string[] {
  const marks: Record<string, string> = { "1": "", "?": "?", "*": "*" };
  return Object.entries(COBERTURA_MODEL.elements as Record<string, {
    children: Array<[string, string]>;
    text: boolean;
    attributes: Record<string, string>;
  }>).map(([name, element]) => {
    const children = element.children.map(([child, occurrence]) => `${child}${marks[occurrence]}`).join(", ");
    const attributes = Object.entries(element.attributes)
      .map(([attribute, use]) => `${attribute}${use === "required" ? "!" : "~"}`)
      .join(", ");
    return `${name} | ${children || "-"} | ${attributes || "-"} |${element.text ? " text" : ""}`;
  });
}

const HEAD = `<?xml version="1.0" ?>\n<!DOCTYPE coverage SYSTEM "${COBERTURA_SYSTEM_ID}">\n`;

/** A small valid document: one package, one class, one method, one line. */
const VALID = `${HEAD}<coverage line-rate="1" branch-rate="0" lines-covered="1" lines-valid="1" branches-covered="0" branches-valid="0" complexity="0" version="iris-mcp-dev 0.0.2" timestamp="1">
  <sources>
    <source>src</source>
  </sources>
  <packages>
    <package name="P" line-rate="1" branch-rate="0" complexity="0">
      <classes>
        <class name="P.C" filename="P/C.cls" line-rate="1" branch-rate="0" complexity="0">
          <methods>
            <method name="M" signature="" line-rate="1" branch-rate="0">
              <lines>
                <line number="3" hits="1"/>
              </lines>
            </method>
          </methods>
          <lines>
            <line number="3" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

describe("scripts/lib/cobertura-dtd.mjs", () => {
  it("records the provenance of the pinned DTD copy and encodes exactly the hand-checked model", () => {
    expect(COBERTURA_DTD_SOURCE).toMatchObject({
      repository: "cobertura/web",
      path: "htdocs/xml/coverage-04.dtd",
      commit: "f0366e5e2cf18f111cbd61fc34ef720a6584ba02",
      sha256: "61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06",
      bytes: 2030,
    });
    expect(describeModel()).toEqual(HAND_CHECKED_MODEL);
    expect(COBERTURA_MODEL.root).toBe("coverage");
  });

  it("accepts a valid document", () => {
    expect(validateCobertura(VALID)).toEqual([]);
    const parsed = parseXml(VALID);
    expect(parsed.doctype).toEqual({ root: "coverage", systemId: COBERTURA_SYSTEM_ID });
    expect(parsed.root.attributes["lines-valid"]).toBe("1");
  });

  it("accepts a document without <sources>, with empty <packages/> and with empty <methods/>", () => {
    expect(validateCobertura(VALID.replace(/<sources>[\s\S]*?<\/sources>\n  /, ""))).toEqual([]);
    expect(validateCobertura(VALID.replace(/<packages>[\s\S]*<\/packages>/, "<packages/>"))).toEqual([]);
    expect(validateCobertura(VALID.replace(/<methods>[\s\S]*?<\/methods>/, "<methods/>"))).toEqual([]);
  });

  it.each([
    ["a dropped required attribute (hits)", VALID.replace(' hits="1"/>', "/>"), /the required attribute hits is missing/],
    ["a dropped required attribute (timestamp)", VALID.replace(' timestamp="1"', ""), /required attribute timestamp is missing/],
    ["a method that declares complexity, which the pinned DTD does not", VALID.replace('signature=""', 'signature="" complexity="0"'), /attribute complexity is not declared/],
    ["a child out of order (lines before methods)", VALID.replace(/(<methods>[\s\S]*?<\/methods>)(\s*)(<lines>[\s\S]*?<\/lines>)(\s*<\/class>)/, "$3$2$1$4"), /(not allowed here or is out of order|missing or out of order)/],
    ["a missing required child (class without lines)", VALID.replace(/(<\/methods>)\s*<lines>[\s\S]*?<\/lines>(\s*<\/class>)/, "$1$2"), /the required child <lines> is missing/],
    ["a repeated single child (two <packages>)", VALID.replace("</packages>", "</packages><packages/>"), /<packages> \(position 3\) is not allowed/],
    ["an undeclared element", VALID.replace("<sources>", "<extra/><sources>"), /the element <extra> is not declared/],
    ["text in element content", VALID.replace("<packages>", "<packages>oops"), /text is not allowed in <packages>/],
    ["no DOCTYPE", VALID.replace(/<!DOCTYPE[^>]*>\n/, ""), /no DOCTYPE/],
    ["a DOCTYPE that names another DTD", VALID.replace("coverage-04.dtd", "coverage-03.dtd"), /names the system id/],
    ["a wrong root", VALID.replace(/<coverage /, "<report ").replace("</coverage>", "</report>"), /root element is <report>/],
    ["an unknown entity", VALID.replace("<source>src</source>", "<source>&nbsp;</source>"), /unknown entity &nbsp;/],
    ["a mismatched end tag", VALID.replace("</lines>\n        </class>", "</line>\n        </class>"), /does not match/],
    ["an unquoted attribute value", VALID.replace('hits="1"/>\n              </lines>', "hits=1/>\n              </lines>"), /must be quoted/],
  ])("rejects %s", (_name, document, expected) => {
    const problems = validateCobertura(document);
    expect(problems.length, "the validator found a problem").toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(expected);
  });

  it("decodes entities in attribute values and text", () => {
    const document = VALID.replace("<source>src</source>", "<source>a &amp; b &lt; c &#65;&#x42;</source>");
    expect(validateCobertura(document)).toEqual([]);
    expect(parseXml(document).root.children[0].children[0].text).toBe("a & b < c AB");
  });
});
