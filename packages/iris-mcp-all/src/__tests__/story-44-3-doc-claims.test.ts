/**
 * Story 44.3 (AC 44.3.6) -- the documents say what Story 44.3 changed: a confirmation is bound to the scope the dialog showed.
 *
 * The stdio and unit suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the root README: the `CONFIRMATION_SCOPE_CHANGED` row of the refusal table, and in the Human confirmation section the scope digest
 *    of the `v: 2` state, the one re-ask, the second `resendFiltered` preview (and no longer "the preview runs only on the round that
 *    asks") and the audit entry of a scope-changed refusal;
 *  - the shared package README: `REFUSAL_CODES.CONFIRMATION_SCOPE_CHANGED` and the `ConfirmationScope` of `ToolContext.confirm`;
 *  - the READMEs of the two packages whose gates bind a value: the promotion's re-ask and refusal, the second preview;
 *  - the CHANGELOG section (its heading keeps matching once the release names the version) and, while it exists, the changeset.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

const rootReadme = read("README.md");
const section = squash(/^### Human confirmation \(elicitation\)$[\s\S]*?(?=^### )/m.exec(rootReadme)?.[0] ?? "");
const sharedReadme = read("packages/shared/README.md");

describe("Story 44.3 docs: the root README", () => {
  it("the refusal table has a CONFIRMATION_SCOPE_CHANGED row with its sanction, its payload and its audit entry", () => {
    const row = lineStarting(rootReadme, "| `CONFIRMATION_SCOPE_CHANGED` |");
    expect(row).toContain("`S-44.3-scope-changed-refusal`");
    expect(row).toContain("`structuredContent` is `{code, action}`");
    expect(row).toContain("`denied` with `denyReason` `CONFIRMATION_SCOPE_CHANGED` and `confirmation` `accepted`");
  });

  it("the Human confirmation section states the scope digest, the one re-ask, the second preview and the audit entry", () => {
    expect(section).toContain("a digest of the scope the dialog showed");
    expect(section).toContain("`v: 2`");
    expect(section).toContain("A different digest asks again, once per call");
    expect(section).toContain("The round that carries the person's accept sends the preview once more");
    expect(section).toContain('a call ended by `CONFIRMATION_SCOPE_CHANGED` is `outcome: "denied"`');
    expect(section).not.toContain("The `resendFiltered` preview runs only on the round that asks");
  });
});

describe("Story 44.3 docs: the package READMEs", () => {
  it("the shared README lists the new refusal code and the ConfirmationScope of ToolContext.confirm", () => {
    expect(lineStarting(sharedReadme, "- **`REFUSAL_CODES.CONFIRMATION_SCOPE_CHANGED`**")).toContain('`denyReason: "CONFIRMATION_SCOPE_CHANGED"`');
    const confirm = lineStarting(sharedReadme, "- **`ToolContext.confirm(request)`**");
    expect(confirm).toContain("`ConfirmationScope` `{text, binding}`");
    expect(confirm).toContain("again on the round that carries the person's accept");
  });

  it("the dev README names the promotion's re-ask and refusal, and the interop README the second preview", () => {
    expect(squash(read("packages/iris-dev-mcp/README.md"))).toContain("asked again once with the new drops, and a second change ends the call with `CONFIRMATION_SCOPE_CHANGED`");
    expect(squash(read("packages/iris-interop-mcp/README.md"))).toContain("the round that carries the person's accept sends the preview once more");
  });
});

describe("Story 44.3 docs: the CHANGELOG and the changeset", () => {
  const changesetPath = ".changeset/story-44-3-confirmation-bound-to-the-scope-shown.md";
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it("the CHANGELOG section names DW-670, the sanction and the extra preview", () => {
    const entry = squash(/^## \[[^\]]*\] \S Story 44\.3: Confirmation Bound to the Scope Shown$[\s\S]*?(?=^## )/m.exec(read("CHANGELOG.md"))?.[0] ?? "");
    expect(entry).toContain("DW-670");
    expect(entry).toContain("`S-44.3-scope-changed-refusal`");
    expect(entry).toContain("`CONFIRMATION_SCOPE_CHANGED`");
    expect(entry).toContain("sends its read-only preview twice");
  });

  it.skipIf(!present)("the changeset bumps shared, dev and interop as a patch and names the code", () => {
    const text = read(changesetPath);
    expect(/^---\n([\s\S]*?)\n---/.exec(text)?.[1]?.split("\n")).toEqual(['"@iris-mcp/shared": patch', '"@iris-mcp/dev": patch', '"@iris-mcp/interop": patch']);
    expect(squash(text)).toContain("`CONFIRMATION_SCOPE_CHANGED`");
    expect(squash(text)).toContain("DW-670");
  });
});
