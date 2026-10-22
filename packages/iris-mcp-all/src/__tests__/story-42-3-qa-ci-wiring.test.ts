/**
 * Story 42.3 QA (DW-666; AC 42.3.5; the CI scripts' usage exits; Rule #3, Rule #59) -- three things the story's own tests leave to
 * the first CI run:
 *
 *  1. THE LINT POLICY. `ci.yml` runs `pnpm lint` as a gate, and DW-666 made a warning fail it by giving every package's `lint` script
 *     `--max-warnings 0`. No default-suite test read those scripts, and the warning the story removed (an unused `eslint-disable`
 *     directive) is one `--max-warnings 0` alone turns into a failure. Here every package's script is pinned, and the real ESLint
 *     of `@iris-mcp/shared` is run with the flags of that script over a source with an unused directive (it must fail) and over
 *     the file the story cleaned (it must pass).
 *  2. THE STEP REFERENCES OF `ci.yml`. Every `steps.<id>` an `if:` names must be the `id` of an EARLIER step of the same job, and
 *     every expression context must be one GitHub offers there. `ci-workflow.test.ts` holds the workflow equal to the registry, so a
 *     typo that the registry shares (an `id: sed` beside `steps.seed.outcome`) survives it; GitHub reads such a condition as an
 *     empty outcome and skips every suite behind it. The check runs over the real file and over a mutation of it for each defect.
 *  3. THE USAGE EXITS of `ci-seed-throwaway.mjs` and `ci-package-smoke.mjs` run as processes: an argument is refused with exit 2
 *     before anything is loaded, packed or contacted.
 *
 * Reads documents, runs ESLint on one file and a source string, and starts two scripts that exit at once: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { REPO_ROOT, PACKAGES_DIR, workspacePackageDirs } from "../../../../scripts/lib/live-gate-scan.mjs";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

describe("DW-666: every package that lints fails on a warning", () => {
  const lintScripts: Array<[string, string]> = workspacePackageDirs().flatMap((dir: string) => {
    const script = readJson<{ scripts?: Record<string, string> }>(path.join(PACKAGES_DIR, dir, "package.json")).scripts?.["lint"];
    return typeof script === "string" ? [[dir, script] as [string, string]] : [];
  });

  it("finds the lint scripts of the packages, and each is `eslint src/ --max-warnings 0`", () => {
    expect(lintScripts.length, "the scan finds the packages that lint").toBeGreaterThanOrEqual(7);
    expect(lintScripts.filter(([, script]) => script !== "eslint src/ --max-warnings 0")).toEqual([]);
  });

  /** ESLint of `@iris-mcp/shared` with the flags of its `lint` script, over `target` (files) or over `stdinSource` (a source named like a file of `src/`). */
  function eslintShared(target: { files: string[] } | { stdinSource: string }): { status: number | null; output: string } {
    const script = lintScripts.find(([dir]) => dir === "shared")?.[1] ?? "";
    const flags = script.split(/\s+/).slice(1).filter((token) => token !== "src/");
    const input = "stdinSource" in target ? target.stdinSource : undefined;
    const where = "files" in target ? target.files : ["--stdin", "--stdin-filename", "src/qa-lint-policy.ts"];
    const result = spawnSync("pnpm", ["exec", "eslint", ...where, ...flags], {
      cwd: path.join(PACKAGES_DIR, "shared"),
      input,
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  it.skipIf(process.platform === "win32")("passes a clean source, fails an unused eslint-disable directive, and passes the file DW-666 cleaned, under the script's own flags", () => {
    const clean = eslintShared({ stdinSource: "export const answer = 1;\n" });
    expect(clean.status, clean.output).toBe(0);

    const directive = eslintShared({ stdinSource: "// eslint-disable-next-line no-console\nexport const answer = 1;\n" });
    expect(directive.status, "an unused directive is a warning, and the flags make a warning a failure").toBe(1);
    expect(directive.output).toMatch(/Unused eslint-disable directive/);
    expect(directive.output).toMatch(/too many warnings/i);

    const governance = eslintShared({ files: ["src/cli/governance.ts"] });
    expect(governance.status, governance.output).toBe(0);
  }, 180_000);
});

describe("ci.yml: every step reference resolves to an earlier step, and every expression context exists there", () => {
  const text = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

  /** The contexts a `${{ }}` expression of this workflow may name. */
  const CONTEXTS = new Set(["github", "matrix", "steps", "runner"]);

  /** What is wrong with the step references and expression contexts of a workflow text. */
  function referenceProblems(source: string): string[] {
    const problems: string[] = [];
    const workflow = parse(source) as { jobs: Record<string, { strategy?: { matrix?: unknown }; steps?: Array<Record<string, unknown>> }> };
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const defined = new Set<string>();
      for (const step of job.steps ?? []) {
        const strings: string[] = [];
        const collect = (value: unknown): void => {
          if (typeof value === "string") strings.push(value);
          else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(step);
        for (const expression of strings.flatMap((value) => [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1] as string))) {
          for (const match of expression.matchAll(/(?<![\w.'-])([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)/g)) {
            const [, context, member] = match as unknown as [string, string, string];
            if (!CONTEXTS.has(context)) problems.push(`${jobName}: the expression context ${context} (${context}.${member}) is not one this workflow uses`);
            else if (context === "matrix" && job.strategy?.matrix === undefined) problems.push(`${jobName}: matrix.${member} is used in a job with no matrix`);
            else if (context === "steps" && !defined.has(member)) problems.push(`${jobName}: steps.${member} names no earlier step of the job`);
          }
        }
        if (typeof step["id"] === "string") {
          if (defined.has(step["id"])) problems.push(`${jobName}: the step id ${step["id"]} is used twice`);
          defined.add(step["id"]);
        }
      }
    }
    return problems;
  }

  /** `source` with the one occurrence of `from` replaced; a `from` that is not in it is a mistake of the test. */
  function mutate(source: string, from: string, to: string): string {
    if (!source.includes(from)) throw new Error(`the mutation target is not in ci.yml: ${from}`);
    return source.split(from).join(to);
  }

  it("the real ci.yml has no unresolved reference", () => {
    expect(referenceProblems(text)).toEqual([]);
    const referenced = [...text.matchAll(/steps\.([a-z]+)\.outcome/g)].map((match) => match[1]);
    expect(new Set(referenced), "the scan sees the conditions that gate the suites").toEqual(new Set(["setup", "up", "seed"]));
  });

  it.each([
    ["an id renamed in the step but not in the conditions behind it", () => mutate(text, "        id: seed\n", "        id: sed\n"), /steps\.seed names no earlier step/],
    [
      "a condition that names a step defined later",
      () => mutate(text, "        id: up\n        if: \"${{ !cancelled() && steps.setup.outcome == 'success' }}\"", "        id: up\n        if: \"${{ !cancelled() && steps.seed.outcome == 'success' }}\""),
      /steps\.seed names no earlier step/,
    ],
    ["a step id used twice", () => mutate(text, "        id: up\n", "        id: setup\n"), /the step id setup is used twice/],
    ["an expression context the workflow does not use", () => mutate(text, "${{ runner.temp }}/throwaway-live.json -- node scripts/ci-seed-throwaway.mjs", "${{ runnr.temp }}/throwaway-live.json -- node scripts/ci-seed-throwaway.mjs"), /expression context runnr/],
    ["the matrix used in a job that has none", () => mutate(text, "      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: package smoke", "      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: package smoke\n        if: ${{ matrix.node == '22.17.0' }}"), /matrix\.node is used in a job with no matrix/],
  ] as Array<[string, () => string, RegExp]>)("finds %s", (_label, apply, expected) => {
    expect(referenceProblems(apply()).join("\n")).toMatch(expected);
  });
});

describe("the CI scripts refuse an argument with exit 2, before they load, pack or contact anything", () => {
  it.each(["ci-seed-throwaway.mjs", "ci-package-smoke.mjs"])("%s", (script) => {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", script), "unexpected-argument"], {
      env: { PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toMatch(new RegExp(`usage: node scripts/${script.replace(".", "\\.")}`));
    expect(result.stdout).toBe("");
  });
});
