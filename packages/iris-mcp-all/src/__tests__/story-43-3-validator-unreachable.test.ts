/**
 * Story 43.3 (DW-637, AD-34, AD-32; Rules #54, #59) - the tripwire behind the verdict on the SDK's bundled JSON-schema validator.
 *
 * `@modelcontextprotocol/server` 2.3.1 bundles ajv 8.18.0, ajv-formats 3.0.1 and fast-uri 3.1.0 (`ajvProvider-*.mjs`), which `pnpm audit`
 * cannot see; fast-uri 3.1.0 is affected by nine advisories fixed in 3.1.8. They are unreachable from this suite only while the server never
 * invokes that validator: the legacy shim of the SDK is configured with `validateAcceptedContent: false`, the 2026-07-28 path does not
 * validate, and the confirmation helper reads the answer itself. The validator would be reached through a call of `elicitInput`
 * (`ctx.mcpReq.elicitInput` or the server's), through `fromJsonSchema`, through a `jsonSchemaValidator` option, or through the
 * three-argument form of `acceptedContent`, which validates the content against a schema.
 *
 * This file fails when any non-test source under `packages/*` or `extensions/*` references one of them outside a comment. The rows at
 * the top prove the pattern matches each form and ignores the same words in a comment.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

/** `source` with every comment replaced by blanks of the same length (line breaks kept), string and template literals untouched. */
function withoutComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        output += " ";
        index += 1;
      }
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (; index < stop; index += 1) output += source[index] === "\n" ? "\n" : " ";
    } else if (char === '"' || char === "'" || char === "`") {
      let literal = char;
      index += 1;
      while (index < source.length) {
        const current = source[index] as string;
        literal += current;
        index += 1;
        if (current === "\\" && index < source.length) {
          literal += source[index];
          index += 1;
        } else if (current === char) break;
      }
      output += literal;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

/** The number of top-level arguments of the call whose opening parenthesis is at `open`, or `0` when the call is not closed. */
function argumentCount(code: string, open: number): number {
  let depth = 0;
  let count = 0;
  let sawContent = false;
  for (let index = open; index < code.length; index += 1) {
    const char = code[index] as string;
    if (char === '"' || char === "'" || char === "`") {
      sawContent = true;
      for (index += 1; index < code.length && code[index] !== char; index += 1) if (code[index] === "\\") index += 1;
    } else if ("([{".includes(char)) {
      depth += 1;
      if (depth > 1) sawContent = true;
    } else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) return sawContent ? count + 1 : 0;
    } else if (char === "," && depth === 1) {
      count += 1;
    } else if (depth >= 1 && !/\s/.test(char)) {
      sawContent = true;
    }
  }
  return 0;
}

/** What `source` references that would reach the validator, outside comments. */
function validatorReferences(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  for (const word of ["elicitInput", "fromJsonSchema", "jsonSchemaValidator"]) {
    if (new RegExp(`\\b${word}\\b`).test(code)) found.push(word);
  }
  for (const match of code.matchAll(/\bacceptedContent\s*(?:<[^>(]*>)?\s*\(/g)) {
    if (argumentCount(code, match.index + match[0].length - 1) >= 3) found.push("acceptedContent with a schema");
  }
  return found;
}

describe("the pattern", () => {
  it.each([
    ["ctx.mcpReq.elicitInput", "const answer = await ctx.mcpReq.elicitInput({ message: 'x' });", ["elicitInput"]],
    ["the server's elicitInput", "await server.server.elicitInput(params);", ["elicitInput"]],
    ["elicitInput passed on", "run(ctx.mcpReq.elicitInput);", ["elicitInput"]],
    ["fromJsonSchema", "const schema = fromJsonSchema(raw);", ["fromJsonSchema"]],
    ["a jsonSchemaValidator option", "new McpServer(info, { jsonSchemaValidator: custom });", ["jsonSchemaValidator"]],
    ["acceptedContent with a schema", "const body = acceptedContent(responses, 'confirm', schema);", ["acceptedContent with a schema"]],
    [
      "acceptedContent with a schema over several lines",
      "const body = acceptedContent(\n  ctx.mcpReq.inputResponses,\n  'confirm',\n  z.object({ confirm: z.boolean() }),\n);",
      ["acceptedContent with a schema"],
    ],
    ["acceptedContent with a type argument and a schema", "acceptedContent<Shape>(responses, key(a, b), schema);", ["acceptedContent with a schema"]],
    ["acceptedContent whose second argument has commas", "acceptedContent(responses, ['a', 'b'], schema);", ["acceptedContent with a schema"]],
    ["two of them", "elicitInput(a); fromJsonSchema(b);", ["elicitInput", "fromJsonSchema"]],
  ])("matches %s", (_label, source, expected) => {
    expect(validatorReferences(source)).toEqual(expected);
  });

  it.each([
    ["a line comment", "// the helper never calls elicitInput( or fromJsonSchema(\nconst x = 1;"],
    ["a trailing line comment", "const x = 1; // jsonSchemaValidator is not set"],
    ["a block comment", "/* elicitInput and acceptedContent(a, b, c) */\nconst x = 1;"],
    ["a doc comment", "/**\n * Not fromJsonSchema.\n * acceptedContent(responses, key, schema) is not used.\n */\nconst x = 1;"],
    ["acceptedContent with two arguments", "const body = acceptedContent(responses, 'confirm');"],
    ["acceptedContent with two arguments whose first has commas", "acceptedContent(pick(a, b, c), 'confirm');"],
    ["acceptedContent with a nested call as its only argument", "acceptedContent(f(a, b, c));"],
    ["an unrelated word that contains one", "const elicitInputs = []; const jsonSchemaValidatorName = 1; const myFromJsonSchemaLike = 2;"],
    ["a URL in a string before a comment", "const url = 'http://example.com/path'; // fromJsonSchema"],
  ])("ignores %s", (_label, source) => {
    expect(validatorReferences(source)).toEqual([]);
  });

  it("is conservative: a string literal that names one still counts", () => {
    expect(validatorReferences("const note = 'do not call elicitInput here';")).toEqual(["elicitInput"]);
  });
});

/** Every non-test TypeScript or script source under the packages and extensions, repo-relative. */
function sources(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "__tests__"].includes(entry.name)) walk(relative);
      } else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        found.push(relative);
      }
    }
  };
  for (const parent of ["packages", "extensions"]) {
    for (const name of readdirSync(path.join(REPO_ROOT, parent))) {
      if (statSync(path.join(REPO_ROOT, parent, name)).isDirectory() && existsSync(path.join(REPO_ROOT, parent, name, "src"))) {
        walk(`${parent}/${name}/src`);
      }
    }
  }
  return found;
}

describe("the sources of the suite", () => {
  it("scans the framework and every server, so the check is not vacuous", () => {
    const files = sources();
    expect(files).toContain("packages/shared/src/server-base.ts");
    expect(files).toContain("packages/shared/src/confirmation.ts");
    expect(files).toContain("packages/iris-admin-mcp/src/tools/audit.ts");
    expect(files.length).toBeGreaterThan(100);
  });

  it("none references elicitInput, fromJsonSchema, jsonSchemaValidator or a three-argument acceptedContent outside a comment", () => {
    const offenders = sources()
      .map((file) => [file, validatorReferences(readFileSync(path.join(REPO_ROOT, file), "utf8"))] as const)
      .filter(([, references]) => references.length > 0);
    expect(offenders).toEqual([]);
  });
});
