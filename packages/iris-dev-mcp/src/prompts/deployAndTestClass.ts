/**
 * `deploy-and-test-class` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Walks the deploy loop: `iris_doc_load` with a GLOB-PREFIXED path (Rule
 * #17), a compile-error fix loop, then `iris_execute_tests` with the
 * returned-`total`-vs-expected check (Rule #35). Server: iris-dev-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg } from "@iris-mcp/shared";

export const deployAndTestClassPrompt: PromptDefinition = {
  name: "deploy-and-test-class",
  title: "Deploy And Test Class",
  description:
    "Deploy an ObjectScript class or package to IRIS (iris_doc_load, glob-path form), fix " +
    "compile errors, then run its unit tests (iris_execute_tests) with a total-count check.",
  arguments: [
    {
      name: "classOrPackage",
      description:
        "Fully qualified ObjectScript class name (e.g. 'MyApp.MyClass') or package name (e.g. 'MyApp.Tests') to deploy and test.",
      required: true,
    },
  ],
  build: (args) => {
    const target = arg(args.classOrPackage, "<classOrPackage>");

    return `# Deploy And Test Class

Target: \`${target}\`

1. Deploy: call \`iris_doc_load\` with a **glob-prefixed path** rooted at the local source directory this class/package lives under, e.g. \`c:/path/to/src/**/${target.replace(/\./g, "/")}*.cls\` — a bare (non-glob) file path mis-maps the class name (Rule #17), so ALWAYS include a directory prefix ending in \`**/*.cls\` or \`**/<ClassName>.cls\`. Pass \`compile: true\`.
2. If the response reports compile errors, read each error's document/line/message, fix the SOURCE \`.cls\` file on disk (never edit generated/compiled output), and re-run step 1. Repeat until \`iris_doc_load\` reports zero compile errors.
3. Determine the test level: if \`${target}\` names a single class ending in a recognizable test-class pattern (or the user says "just this class"), use \`level: "class"\`; if it names a package, use \`level: "package"\`; if the user names one specific test method, use \`level: "method"\` with \`target: "ClassName:MethodName"\`.
4. Call \`iris_execute_tests\` with \`target: "${target}"\` and the chosen \`level\`.
5. **Compare the returned \`total\` against the expected number of test methods** (count them from the source file(s) you just deployed, or ask the user). \`iris_execute_tests\` can return an early PARTIAL snapshot — all passing, fewer tests than exist (Rule #35) — which looks identical to a genuine green run unless the count is checked.
6. If \`total\` is short of the expected count, rerun \`iris_execute_tests\` (prefer a per-class call when precision matters) before reporting the run as green.
7. Report the final pass/fail/skipped counts and any failure details to the user.`;
  },
};
