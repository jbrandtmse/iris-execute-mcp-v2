/**
 * `edit-and-test-class` prompt (Story 38.6).
 *
 * Walks the in-place edit loop for a class already in IRIS: a ranged
 * `iris_doc_get`, a guarded `iris_doc_edit`, `iris_doc_compile`, then
 * `iris_execute_tests` with the returned-`total`-vs-`Test*`-methods check.
 * Every tool on the main path is in the dev `core` preset. Server:
 * iris-dev-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

export const editAndTestClassPrompt: PromptDefinition = {
  name: "edit-and-test-class",
  title: "Edit And Test Class",
  description:
    "Change a few lines of an ObjectScript class in place (ranged iris_doc_get, then a guarded " +
    "iris_doc_edit), compile it (iris_doc_compile), then run its unit tests (iris_execute_tests) " +
    "with a total-count check.",
  arguments: [
    {
      name: "className",
      description: "Fully qualified name of the class to change, without the extension (e.g. 'MyApp.MyClass').",
      required: true,
    },
    {
      name: "change",
      description: "The change to make, in plain words: what to add, remove or alter, and where in the class.",
      required: true,
    },
    {
      name: "testClass",
      description:
        "Fully qualified name of the unit-test class to run afterwards (e.g. 'MyApp.Tests.MyClassTest'). " +
        "When omitted, the prompt tells the model to find the test class that covers the class, or to ask.",
      required: false,
    },
  ],
  build: (args) => {
    const className = arg(args.className, "<className>");
    const change = arg(args.change, "<change>");
    const docName = `${className}.cls`;

    const testStep = isArgProvided(args.testClass)
      ? `Test: call \`iris_execute_tests\` with \`target: "${args.testClass}"\` and \`level: "class"\`.`
      : `Test: find the test class that covers \`${className}\` (for example with \`iris_doc_list\` and a \`filter\` on the class's name or its package's tests), or ask the user which test class to run if you cannot tell. Then call \`iris_execute_tests\` with that class as \`target\` and \`level: "class"\`.`;

    return `# Edit And Test Class

Class: \`${className}\`

Change to make: ${change}

1. Read: call \`iris_doc_get\` with \`name: "${docName}"\` and \`startLine\` / \`endLine\` covering the lines to change and a few lines around them. Keep the returned numbered \`lines\` and the version \`ts\`. Read the whole document only if you cannot tell where the change belongs.
2. Edit: call \`iris_doc_edit\` with \`action: "apply"\`, \`name: "${docName}"\` and one entry in \`edits\` per change (\`insert\`, \`delete\` or \`replace\`), numbered as in that read. Build each edit's \`expected\` from the read's \`lines\`, with every line followed by a line break (\`\\n\`), the last line included. The edit is applied only if \`expected\` matches the document exactly, so nothing is overwritten blindly.
3. If the response is a \`STALE_CONTENT\` refusal, nothing was stored. Pass each \`mismatches[].current\` back as that edit's \`expected\`, unchanged, once your change still applies to that text; otherwise read the lines again (step 1) and redo the edit.
4. If the response is a \`DOCUMENT_CONFLICT\` refusal, the class changed after you read it and nothing was stored: read the lines again (step 1) and redo the edit.
5. If the response is a \`STORAGE_DROPPED\` refusal, the edit would remove the class's Storage definition: keep the Storage lines in your edit. Never use action \`regenerateStorage\` unless the user explicitly asks for it: it is disabled by default and it changes how the class's data is laid out.
6. If the response is a \`GOVERNANCE_DISABLED\` refusal, the operator has turned editing off: stop and tell the user.
7. IRIS reformats class source when it saves (it adds blank lines between members, for example), so take the line numbers for any further edit from the result's excerpts and \`ts\`, or from a fresh ranged \`iris_doc_get\`, never from the numbers you had before the edit.
8. Compile: call \`iris_doc_compile\` with \`doc: "${docName}"\`. If it reports errors, read the reported lines with another ranged \`iris_doc_get\`, fix them with another \`iris_doc_edit\` (steps 2 to 7), and compile again until it compiles with no errors.
9. ${testStep} If the response has \`status: "running"\`, the run has NOT finished: follow the response's \`hint\` to re-attach, and never re-submit the same target (that starts a second concurrent run against shared fixtures).
10. Otherwise, compare the returned \`total\` against the number of \`Test*\` methods in the test class (read its source with \`iris_doc_get\`), and rerun \`iris_execute_tests\` if \`total\` is short: an early partial snapshot, all passing, looks identical to a genuine green run until the count is checked.
11. If a local source file of \`${className}\` exists on disk, it is now out of date because the edit was made in IRIS. Say so, because loading that file again would overwrite the edit.
12. Report the edit's \`unifiedDiff\`, the compile result and the pass, fail and skipped counts, with any failure details.`;
  },
};
