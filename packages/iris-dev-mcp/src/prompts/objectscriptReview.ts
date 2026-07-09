/**
 * `objectscript-review` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Distills `.claude/rules/iris-objectscript-basics.md` + the testing rules
 * into a pre-write checklist for a human/agent about to write or edit
 * ObjectScript. No arguments. The rendered body MUST stay <= 300 words
 * (AC 25.1.1) — see the word-count guard in the prompts guardrail test.
 * Server: iris-dev-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";

const BODY = `# ObjectScript Pre-Write Checklist

Before writing or editing any ObjectScript class, verify:

**Macros & naming**
- Use \`$$$\` (triple dollar) for macros, never \`$$\`. Multiple \`$\`/\`$$\` errors in one file → rewrite the whole file rather than patching piecemeal.
- No underscores in class, method, or parameter names — use camelCase or ALL CAPS instead.
- No \`%\` or \`_\` prefixes on your own properties/parameters (reserved for system classes).

**Methods**
- Status-returning methods: \`Set tSC = $$$OK\` first line, \`Quit tSC\` last line, body wrapped in Try/Catch.
- Inside Try/Catch, \`Quit\` must be ARGUMENTLESS (ERROR #1043 otherwise). Initialize the return variable before the Try block, set it inside, \`Quit\` (no args) at the end of Try and Catch, then \`Quit <var>\` after the block.
- Abstract methods still need a body returning a sane default (\`$$$NULLOREF\`, \`""\`, \`$$$OK\`, \`0\`) — never truly empty.
- \`%OnNew(initvalue As %String = "")\` must call \`##super(initvalue)\` first and check its status; never mark \`%OnNew\` \`Private\`.

**Namespace & REST handlers**
- Never \`New $NAMESPACE\`; save/restore explicitly (\`Set tOrigNS = $NAMESPACE\` ... \`Set $NAMESPACE = tOrigNS\`), restoring BEFORE any catch-block reference to a class from the original namespace.
- Validate inputs before switching to \`%SYS\`.

**Errors**
- Route error text through \`SanitizeError\`; never embed a caret-global name (\`^Name\`) in a message that reaches it — the caret gets silently stripped.

**Storage & structure**
- NEVER hand-edit a class's Storage section — the compiler owns it.
- Use \`///\` for doc comments, not \`//\` (which does not comment in ObjectScript classes).
- Indent every command at least one space or tab.

**Deploy & test**
- Create/edit \`.cls\` files on disk first, then \`iris_doc_load\` with a glob-prefixed path (a bare path mis-maps the class name), then \`iris_execute_tests\` — always compare the returned \`total\` against the expected test count before trusting a "0 failures" run; rerun if short.`;

export const objectscriptReviewPrompt: PromptDefinition = {
  name: "objectscript-review",
  title: "ObjectScript Pre-Write Review",
  description:
    "A concise (<=300 word) pre-write checklist distilling the project's ObjectScript " +
    "conventions ($$$ macros, Quit-in-try/catch, %OnNew/initvalue, no-underscore names, " +
    "storage sections untouchable, deploy/test discipline).",
  arguments: [],
  build: () => BODY,
};
