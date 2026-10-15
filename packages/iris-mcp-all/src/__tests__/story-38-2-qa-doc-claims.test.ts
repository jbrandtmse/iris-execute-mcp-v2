/**
 * Story 38.2 (AC-6, AD-29) -- the documentation claims about the line-range read, held against the
 * thing each one describes.
 *
 * `doc-get-range.test.ts` pins the tool description. This file pins what that test leaves open:
 *
 *  - The README's line-range example is EXECUTED: the BUILT `iris_doc_get` handler is fed the
 *    README's own full-read example as the IRIS `GET /doc` result and given the README's range
 *    input, and its text and `structuredContent` must equal the README's two output blocks. An
 *    example that drifts from the shipped numbering, the 6-column layout or the header goes red.
 *  - The CHANGELOG quotes the header form and the `structuredContent` field list; each is compared
 *    with what the built handler returns. It names the new `@iris-mcp/shared` exports, and each one
 *    exists in the built shared dist.
 *  - The "right-aligned in N columns" claim appears in the description, README, CHANGELOG and
 *    changeset with the width the built `NUMBERED_LINE_WIDTH` really has.
 *  - The README tool-table row lists exactly the tool's schema parameters, with `?` on the optional ones.
 *  - The changeset carries the sanctioned bumps (AD-29: `@iris-mcp/shared` and `@iris-mcp/dev` minor).
 *
 * Needs no IRIS. It reads the built shared and dev dists and FAILS (never skips) when either is
 * missing or stale, because a skip would leave every check here a dead one. Cross-package
 * documentation checks live in `@iris-mcp/all` (Rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_README = "packages/iris-dev-mcp/README.md";

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

interface BuiltToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface BuiltDocGetTool {
  description: string;
  inputSchema: { shape: Record<string, { isOptional: () => boolean }> };
  handler: (args: unknown, ctx: unknown) => Promise<BuiltToolResult>;
}

type BuiltShared = Record<string, unknown> & { NUMBERED_LINE_WIDTH: number };

let builtPromise: Promise<{ docGet: BuiltDocGetTool; shared: BuiltShared }> | undefined;

/** The built dev `iris_doc_get` and the built shared barrel; throws when either dist is missing or stale. */
function built(): Promise<{ docGet: BuiltDocGetTool; shared: BuiltShared }> {
  builtPromise ??= (async () => {
    for (const [dir, label] of [
      ["shared", "@iris-mcp/shared"],
      ["iris-dev-mcp", "@iris-mcp/dev"],
    ] as const) {
      const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", dir), label);
      if (!fresh.ok || fresh.skipped) {
        throw new Error(`${fresh.reason ?? `${label} declares no dist/ build output.`} Rebuild: pnpm --filter ${label} build`);
      }
    }
    const shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as BuiltShared;
    const dev = (await import(
      pathToFileURL(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "tools", "doc.js")).href
    )) as { docGetTool: BuiltDocGetTool };
    return { docGet: dev.docGetTool, shared };
  })();
  return builtPromise;
}

/** A tool context whose `GET /doc` returns `getResult`; any HEAD fails the test. */
function fakeCtx(getResult: unknown): unknown {
  return {
    atelierVersion: 8,
    resolveNamespace: (namespace?: string) => namespace ?? "USER",
    http: {
      get: async () => ({ status: { errors: [] }, console: [], result: getResult }),
      head: async () => {
        throw new Error("a ranged read must not send a HEAD");
      },
    },
  };
}

/** The bodies of the ```json fences in `section`, in order. */
function jsonBlocks(section: string): string[] {
  return [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? "");
}

const readme = read(DEV_README);
const rangeExample = /<summary><strong>iris_doc_get with a line range<\/strong>[\s\S]*?<\/details>/.exec(readme)?.[0] ?? "";
const fullReadExample = /<summary><strong>iris_doc_get<\/strong>[\s\S]*?<\/details>/.exec(readme)?.[0] ?? "";
const changelogSection = /## \[Pre-release[^\]]*\] . Story 38\.2[\s\S]*?(?=\n## \[)/.exec(read("CHANGELOG.md"))?.[0] ?? "";
const changesetPath = ".changeset/story-38-2-line-range-document-read.md";

describe("Story 38.2 README line-range example", () => {
  it("is what the built iris_doc_get returns for the README's own full-read example", async () => {
    const { docGet } = await built();
    expect(rangeExample, "README has the line-range example").not.toBe("");
    expect(fullReadExample, "README has the full-read example").not.toBe("");
    const [rangeInput, rangeStructured] = jsonBlocks(rangeExample);
    const fullRead = JSON.parse(jsonBlocks(fullReadExample)[1] ?? "") as { name: string; ts: string; content: string[] };
    const text = /```\n(Document '[\s\S]*?)\n```/.exec(rangeExample)?.[1] ?? "";
    // An empty parse would compare nothing below.
    expect(text).toContain("\t");
    expect(rangeStructured).toBeDefined();

    const result = await docGet.handler(
      JSON.parse(rangeInput ?? ""),
      fakeCtx({
        name: fullRead.name,
        db: "USER",
        ts: fullRead.ts,
        upd: false,
        cat: "CLS",
        status: "",
        enc: false,
        flags: 0,
        content: fullRead.content,
      }),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(text);
    expect(result.structuredContent).toEqual(JSON.parse(rangeStructured ?? ""));
  });

  it("states a totalLines equal to the full-read example's content length, trailing empty element included", () => {
    const fullRead = JSON.parse(jsonBlocks(fullReadExample)[1] ?? "") as { content: string[] };
    const structured = JSON.parse(jsonBlocks(rangeExample)[1] ?? "") as { totalLines: number };

    expect(fullRead.content.at(-1)).toBe("");
    expect(structured.totalLines).toBe(fullRead.content.length);
  });
});

describe("Story 38.2 README tool-table row", () => {
  it("lists exactly the parameters of the built iris_doc_get schema, with ? on the optional ones", async () => {
    const { docGet } = await built();
    const row = readme.split("\n").find((line) => line.startsWith("| `iris_doc_get` |")) ?? "";
    expect(row, "README has the iris_doc_get tool-table row").not.toBe("");
    const keyParameters = [...(row.split("|")[3] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
    expect(keyParameters.length).toBeGreaterThan(0);

    const documented = Object.fromEntries(keyParameters.map((entry) => [entry.replace(/\?$/, ""), entry.endsWith("?")]));
    const actual = Object.fromEntries(Object.entries(docGet.inputSchema.shape).map(([key, schema]) => [key, schema.isOptional()]));

    expect(documented).toEqual(actual);
  });
});

describe("Story 38.2 CHANGELOG entry", () => {
  it("has a Story 38.2 section with an Added heading for the iris_doc_get line range", () => {
    expect(changelogSection, "CHANGELOG.md has a Story 38.2 section").not.toBe("");
    expect(changelogSection).toMatch(/### Added [^\n]*`iris_doc_get` reads a line range/);
  });

  it("quotes the header form the built handler produces", async () => {
    const { docGet } = await built();
    const quoted = /`(Document '<name>' in namespace '<ns>': lines [^`]*)`/.exec(changelogSection)?.[1] ?? "";
    expect(quoted, "the CHANGELOG quotes the header form").not.toBe("");
    const expected = quoted
      .replace("<name>", "Test.Fixture.cls")
      .replace("<ns>", "USER")
      .replace("<s>", "2")
      .replace("<e>", "3")
      .replace("<t>", "4")
      .replace("<ts>", "2026-09-01 04:29:37.877");

    const result = await docGet.handler(
      { name: "Test.Fixture.cls", startLine: 2, endLine: 3 },
      fakeCtx({
        name: "Test.Fixture.cls",
        db: "USER",
        ts: "2026-09-01 04:29:37.877",
        upd: false,
        cat: "CLS",
        status: "",
        enc: false,
        flags: 0,
        content: ["Class Test.Fixture Extends %RegisteredObject", "{", "}", ""],
      }),
    );

    expect(result.content[0]?.text.split("\n")[0]).toBe(expected);
  });

  it("lists the structuredContent fields the built handler returns, in order", async () => {
    const { docGet } = await built();
    const quoted = /`structuredContent` is `\{ ([^}]*) \}`/.exec(changelogSection)?.[1] ?? "";
    expect(quoted, "the CHANGELOG lists the structuredContent fields").not.toBe("");

    const result = await docGet.handler(
      { name: "Test.Fixture.cls", startLine: 1 },
      fakeCtx({ name: "Test.Fixture.cls", ts: "2026-09-01 04:29:37.877", status: "", enc: false, content: ["a", ""] }),
    );

    expect(Object.keys(result.structuredContent as object)).toEqual(quoted.split(", "));
  });

  it("names each new @iris-mcp/shared export, and the built shared barrel exports it", async () => {
    const { shared } = await built();

    for (const name of ["documentLines", "linesInRange", "formatNumberedLines", "NUMBERED_LINE_WIDTH"]) {
      expect(changelogSection, `the CHANGELOG names ${name}`).toContain(`\`${name}\``);
      expect(shared[name], `the built shared dist exports ${name}`).toBeDefined();
    }
  });
});

describe("Story 38.2 numbered-line width claim", () => {
  it("appears in the description, README, CHANGELOG and changeset with the built NUMBERED_LINE_WIDTH", async () => {
    const { docGet, shared } = await built();
    const claim = new RegExp(`right-aligned\\s+in\\s+${shared.NUMBERED_LINE_WIDTH}\\s+columns`);
    const sources: Array<[string, string]> = [
      ["the tool description", docGet.description],
      ["the README example", rangeExample],
      ["the CHANGELOG section", changelogSection],
    ];
    if (existsSync(path.join(REPO_ROOT, changesetPath))) sources.push(["the changeset", read(changesetPath)]);

    for (const [label, text] of sources) {
      expect(text, label).toMatch(claim);
    }
  });
});

describe("Story 38.2 changeset (AD-29)", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("bumps @iris-mcp/shared and @iris-mcp/dev minor, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(changesetPath))?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontmatter
        .split("\n")
        .map((line) => /^"([^"]+)": (\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1] ?? "", match[2] ?? ""]),
    );

    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "minor" });
  });
});
