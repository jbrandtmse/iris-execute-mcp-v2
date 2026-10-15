/**
 * Story 38.3 (AC-4, AC-6, AC-8, AC-9, AC-10) -- the documentation claims about the Storage-drop guard, held
 * against the thing each one describes.
 *
 * `doc-put-storage-guard.test.ts` pins the handler and the tool description. This file pins what that test
 * leaves open:
 *
 *  - The dev README's `iris_doc_put` examples are EXECUTED: the BUILT handler is fed the README's own input
 *    (and, for the refusal, a 409 built from the README's own sentence about which Storage definitions the
 *    class has and which the content keeps), and its text and `structuredContent` must equal the README's
 *    output blocks.
 *  - The CHANGELOG quotes the refusal text and the `structuredContent` field lists of `STORAGE_DROPPED`,
 *    `DOCUMENT_CONFLICT` and `metadataOnly`; each is compared with what the built handlers return. It names the
 *    new `@iris-mcp/shared` exports, and each runtime export exists in the built shared dist.
 *  - The README tool-table row lists exactly the tool's schema parameters, with `?` on the optional ones, and
 *    states the default of both flags.
 *  - The README names the unguarded paths, and each named tool is still a real tool in the source file the
 *    write-path roster records for it.
 *  - The catalog contract (the code strings live in `refusals.ts` only) and `droppedStorage` (built in
 *    `storage-guard.ts` only, so no other tool's output carries it).
 *  - The changeset carries the sanctioned bumps (AD-29: `@iris-mcp/shared` and `@iris-mcp/dev` minor).
 *
 * Needs no IRIS. It reads the built shared and dev dists and FAILS (never skips) when either is missing or
 * stale, because a skip would leave every check here a dead one. Cross-package documentation checks live in
 * `@iris-mcp/all` (Rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

interface BuiltTool {
  description: string;
  inputSchema: { shape: Record<string, { isOptional: () => boolean }> };
  handler: (args: unknown, ctx: unknown) => Promise<BuiltToolResult>;
}

type BuiltShared = Record<string, unknown> & {
  IrisApiError: new (statusCode: number, errors: unknown[], path: string, message?: string, result?: unknown) => Error;
};

interface Built {
  docPut: BuiltTool;
  docGet: BuiltTool;
  shared: BuiltShared;
}

let builtPromise: Promise<Built> | undefined;

/** The built dev `iris_doc_put` and `iris_doc_get` and the built shared barrel; throws when either dist is missing or stale. */
function built(): Promise<Built> {
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
    )) as { docPutTool: BuiltTool; docGetTool: BuiltTool };
    return { docPut: dev.docPutTool, docGet: dev.docGetTool, shared };
  })();
  return builtPromise;
}

const envelope = (result: unknown) => ({ status: { errors: [] }, console: [], result });

/**
 * A tool context whose `PUT /doc` answers the queued outcomes in order (a value resolves, an Error rejects), and
 * whose GET and HEAD fail the test, as no put may send either. `head` answers `headers` when it is given.
 */
function fakeCtx(puts: unknown[], headers?: Record<string, string>): { ctx: unknown; putCalls: unknown[][] } {
  const putCalls: unknown[][] = [];
  const queue = [...puts];
  const ctx = {
    atelierVersion: 8,
    resolveNamespace: (namespace?: string) => namespace ?? "USER",
    http: {
      put: async (...args: unknown[]) => {
        putCalls.push(args);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      get: async () => {
        throw new Error("no GET may be sent");
      },
      head: async () => {
        if (headers === undefined) throw new Error("no HEAD may be sent");
        return { headers: new Headers(headers) };
      },
    },
  };
  return { ctx, putCalls };
}

/** The bodies of the ```json fences in `section`, in order. */
function jsonBlocks(section: string): string[] {
  return [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? "");
}

/** A class text with the Storage definitions `names`, in the generated layout. */
function classText(className: string, names: string[]): string[] {
  return [
    `Class ${className} Extends %Persistent`,
    "{",
    ...names.flatMap((name) => [`Storage ${name}`, "{", "<Type>%Storage.Persistent</Type>", "}", ""]),
    "}",
    "",
  ];
}

const readme = read(DEV_README);
const putDetails = /<summary><strong>iris_doc_put<\/strong>[\s\S]*?<\/details>/.exec(readme)?.[0] ?? "";
const changelogSection = /## \[Pre-release[^\]]*\] . Story 38\.3[\s\S]*?(?=\n## \[)/.exec(read("CHANGELOG.md"))?.[0] ?? "";
const changesetPath = ".changeset/story-38-3-storage-block-drop-guard.md";

describe("Story 38.3 README iris_doc_put examples", () => {
  it("the input example saves as the output example says, with one PUT and no GET or HEAD", async () => {
    const { docPut } = await built();
    expect(putDetails, "README has the iris_doc_put details block").not.toBe("");
    const [input, output] = jsonBlocks(putDetails);
    expect(input, "README has the input example").toBeDefined();
    const { ctx, putCalls } = fakeCtx([envelope({ name: "MyApp.Utils.cls", status: "", flags: 0, content: [] })]);

    const result = await docPut.handler(JSON.parse(input ?? ""), ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(JSON.parse(output ?? ""));
    expect(putCalls).toHaveLength(1);
  });

  it("the refusal example is what the built handler returns for the class the README describes", async () => {
    const { docPut, shared } = await built();
    const refusalText = /```text\n(Document '[\s\S]*?)\n```/.exec(putDetails)?.[1] ?? "";
    const refusalStructured = jsonBlocks(putDetails)[2] ?? "";
    const names = /Storage definitions `([^`]+)` and `([^`]+)` and the\s+content keeps only `([^`]+)`/.exec(putDetails);
    // An empty parse would compare nothing below.
    expect(refusalText, "README has the refusal text").not.toBe("");
    expect(names, "README says which definitions the class has and which the content keeps").not.toBeNull();
    const [, kept, dropped, keptInContent] = names as RegExpExecArray;
    expect(keptInContent).toBe(kept);
    const refusal = JSON.parse(refusalStructured) as { name: string };
    const className = refusal.name.replace(/\.cls$/, "");
    const path8 = `/api/atelier/v8/USER/doc/${refusal.name}`;
    const conflict = new shared.IrisApiError(409, [], path8, `IRIS returned HTTP 409 for PUT ${path8}.`, {
      name: refusal.name,
      db: "USER",
      ts: "2026-10-15 17:58:02.301",
      upd: false,
      cat: "CLS",
      status: "",
      enc: false,
      flags: 0,
      content: classText(className, [kept as string, dropped as string]),
    });
    const { ctx, putCalls } = fakeCtx([conflict]);

    const result = await docPut.handler({ name: refusal.name, content: classText(className, [kept as string]) }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(refusalText);
    expect(result.structuredContent).toEqual(JSON.parse(refusalStructured));
    expect(putCalls, "the refused put sent only the request the 409 answered").toHaveLength(1);
  });
});

describe("Story 38.3 README tool-table row", () => {
  it("lists exactly the parameters of the built iris_doc_put schema, with ? on the optional ones", async () => {
    const { docPut } = await built();
    const row = readme.split("\n").find((line) => line.startsWith("| `iris_doc_put` |")) ?? "";
    expect(row, "README has the iris_doc_put tool-table row").not.toBe("");
    const keyParameters = [...(row.split("|")[3] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
    expect(keyParameters.length).toBeGreaterThan(0);

    const documented = Object.fromEntries(keyParameters.map((entry) => [entry.replace(/\?$/, ""), entry.endsWith("?")]));
    const actual = Object.fromEntries(Object.entries(docPut.inputSchema.shape).map(([key, schema]) => [key, schema.isOptional()]));

    expect(documented).toEqual(actual);
  });

  it("states the default of both flags, and the tool's own parameter descriptions say the same", async () => {
    const { docPut } = await built();
    const row = readme.split("\n").find((line) => line.startsWith("| `iris_doc_put` |")) ?? "";
    for (const flag of ["ignoreConflict", "allowStorageRegeneration"]) {
      expect(row, `the README row gives ${flag} its default`).toMatch(new RegExp(`\`${flag}\\?\` \\(default: \\*\\*false\\*\\*`));
      const description = (docPut.inputSchema.shape[flag] as unknown as { description?: string }).description ?? "";
      expect(description, `the schema describes ${flag}'s default`).toContain("default false");
    }
  });
});

describe("Story 38.3 CHANGELOG entry", () => {
  it("has a Story 38.3 section with the safety change under Changed, the DW-540 and DW-541 fixes under Fixed, and the exports under Added", () => {
    expect(changelogSection, "CHANGELOG.md has a Story 38.3 section").not.toBe("");
    expect(changelogSection).toMatch(/### Changed [^\n]*safety[^\n]*`iris_doc_put` refuses a put that drops a class's Storage definition/);
    expect(changelogSection).toMatch(/### Fixed[\s\S]*DW-540[\s\S]*DW-541/);
    expect(changelogSection).toMatch(/### Added[\s\S]*`REFUSAL_CODES`/);
  });

  it("quotes the refusal text the built handler produces", async () => {
    const { docPut, shared } = await built();
    const quoted = /`(Document '<name>' was not saved in namespace '<ns>': the content drops[^`]*)`/.exec(changelogSection)?.[1] ?? "";
    expect(quoted, "the CHANGELOG quotes the refusal text").not.toBe("");
    const expected = quoted.replace("<name>", "Test.Fixture.cls").replace("<ns>", "USER");
    const conflict = new shared.IrisApiError(409, [], "/doc", "IRIS returned HTTP 409", {
      name: "Test.Fixture.cls",
      db: "USER",
      ts: "2026-10-15 17:58:02.301",
      upd: false,
      cat: "CLS",
      status: "",
      enc: false,
      flags: 0,
      content: classText("Test.Fixture", ["Default", "Second"]),
    });
    const { ctx } = fakeCtx([conflict]);

    const result = await docPut.handler({ name: "Test.Fixture.cls", content: classText("Test.Fixture", ["Default"]) }, ctx);

    expect(result.content[0]?.text).toBe(expected);
  });

  it("lists the structuredContent fields of STORAGE_DROPPED and DOCUMENT_CONFLICT as the built handler returns them, in order", async () => {
    const { docPut, shared } = await built();
    const currentDocument = (ts: string) => ({
      name: "Test.Fixture.cls",
      db: "USER",
      ts,
      upd: false,
      cat: "CLS",
      status: "",
      enc: false,
      flags: 0,
      content: classText("Test.Fixture", ["Default", "Second"]),
    });
    const conflict = (ts: string) => new shared.IrisApiError(409, [], "/doc", "IRIS returned HTTP 409", currentDocument(ts));

    const dropped = fakeCtx([conflict("1")]);
    const droppedResult = await docPut.handler({ name: "Test.Fixture.cls", content: classText("Test.Fixture", []) }, dropped.ctx);
    const changed = fakeCtx([conflict("1"), conflict("2")]);
    const changedResult = await docPut.handler(
      { name: "Test.Fixture.cls", content: classText("Test.Fixture", ["Default", "Second"]) },
      changed.ctx,
    );

    for (const [code, result] of [
      ["STORAGE_DROPPED", droppedResult],
      ["DOCUMENT_CONFLICT", changedResult],
    ] as const) {
      const quoted = new RegExp(`\`\\{ code: "${code}", ([^}]*) \\}\``).exec(changelogSection)?.[1] ?? "";
      expect(quoted, `the CHANGELOG lists the ${code} fields`).not.toBe("");
      expect(result.isError, code).toBe(true);
      expect(Object.keys(result.structuredContent as object), code).toEqual(["code", ...quoted.split(", ")]);
      expect((result.structuredContent as { code: string }).code).toBe(code);
    }
  });

  it("lists the metadataOnly fields the built iris_doc_get returns", async () => {
    const { docGet } = await built();
    const quoted = /`structuredContent` is now\s+`\{ (exists[^}]*) \}`/.exec(changelogSection)?.[1] ?? "";
    expect(quoted, "the CHANGELOG lists the metadataOnly fields").not.toBe("");
    const { ctx } = fakeCtx([], { ETag: "2026-10-15 17:58:02.301" });

    const result = await docGet.handler({ name: "Test.Fixture.cls", metadataOnly: true }, ctx);

    expect(Object.keys(result.structuredContent as object)).toEqual(quoted.split(", "));
  });

  it("names each new @iris-mcp/shared export, and the built shared barrel exports each runtime value", async () => {
    const { shared } = await built();

    for (const name of ["REFUSAL_CODES", "refusalResult", "RefusalCode", "RefusalResult", "isClassDocument", "storageDefinitionNames", "droppedStorageDefinitions", "storageDroppedRefusal"]) {
      expect(changelogSection, `the CHANGELOG names ${name}`).toContain(`\`${name}\``);
    }
    for (const name of ["REFUSAL_CODES", "refusalResult", "isClassDocument", "storageDefinitionNames", "droppedStorageDefinitions", "storageDroppedRefusal"]) {
      expect(shared[name], `the built shared dist exports ${name}`).toBeDefined();
    }
  });

  it("names the three recorded exclusions, and the write-path roster records each of their ids", () => {
    const roster = read("packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts");
    for (const id of ["DW-544", "DW-545", "DW-546"]) {
      expect(changelogSection, `the CHANGELOG names ${id}`).toContain(id);
      expect(roster, `the roster records ${id}`).toContain(`"${id}"`);
    }
  });
});

describe("Story 38.3 README unguarded paths (AC-6)", () => {
  // The tools the README names as unguarded or as not writing documents, with the roster's source file for each.
  const NAMED: Array<[string, string]> = [
    ["iris_doc_load", "packages/iris-dev-mcp/src/tools/load.ts"],
    ["iris_env_promote", "packages/iris-dev-mcp/src/tools/env-promote.ts"],
    ["iris_doc_xml_export", "packages/iris-dev-mcp/src/tools/format.ts"],
    ["iris_docdb_document", "packages/iris-data-mcp/src/tools/docdb.ts"],
    ["iris_global_set", "packages/iris-dev-mcp/src/tools/global.ts"],
  ];

  it("names each path the write-path roster records, and each named tool is still defined in that source file", () => {
    const unguarded = /- \*\*Unguarded paths\.\*\*[\s\S]*?(?=\n\n)/.exec(putDetails)?.[0] ?? "";
    expect(unguarded, "README has the unguarded-paths item").not.toBe("");
    for (const [tool, file] of NAMED) {
      expect(unguarded, `the README names ${tool}`).toContain(tool);
      expect(read(file), `${file} defines ${tool}`).toContain(`"${tool}"`);
    }
    // The roster's excluded and not-a-document-write entries are exactly the files above: a new one needs a README line.
    const roster = read("packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts");
    const rosterFiles = [
      ...roster.matchAll(/file: "([^"]+)",\s*pattern: "\w+",\s*count: \d+,\s*verdict: "(?:excluded|not-a-document-write)"/g),
    ].map((match) => match[1]);
    expect(rosterFiles.length, "the roster's unguarded entries are found").toBeGreaterThan(0);
    expect([...rosterFiles].sort(), "the README covers every unguarded roster entry").toEqual(NAMED.map(([, file]) => file).sort());
  });
});

describe("Story 38.3 catalog contract and the droppedStorage field (AC-9, AC-10)", () => {
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

  /** The files whose non-comment lines match `expression`. */
  function filesMatching(expression: RegExp): string[] {
    return sources().filter((file) =>
      read(file)
        .split("\n")
        .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && expression.test(line)),
    );
  }

  it("the refusal codes are quoted strings in refusals.ts only, never inline at a call site", () => {
    for (const code of ["GOVERNANCE_DISABLED", "STORAGE_DROPPED", "DOCUMENT_CONFLICT"]) {
      expect(filesMatching(new RegExp(`["'\`]${code}["'\`]`)), code).toEqual(["packages/shared/src/refusals.ts"]);
    }
  });

  it("droppedStorage is built in storage-guard.ts only, so no other tool's output carries it", () => {
    expect(filesMatching(/\bdroppedStorage\b/)).toEqual(["packages/shared/src/storage-guard.ts"]);
  });
});

describe("Story 38.3 changeset (AD-29)", () => {
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

  it.skipIf(!present)("names the refusal code and the override", () => {
    const text = read(changesetPath);
    expect(text).toContain("STORAGE_DROPPED");
    expect(text).toContain("allowStorageRegeneration");
    expect(text).toContain("DOCUMENT_CONFLICT");
  });
});
