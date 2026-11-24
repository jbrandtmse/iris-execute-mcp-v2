/**
 * Story 44.5 QA (AC 44.5.2, AC 44.5.3, AC 44.5.4, DW-726; Rules #19, #59) -- the CI step that enables `%Service_DocDB`, held from
 * four sides that `ci-workflow.test.ts` and `ci-live-suite.test.ts` leave open:
 *
 *   - the registry (`scripts/lib/ci-checks.mjs`): the step sits after the suite that holds the Epic 35 F5 gate (which needs the
 *     service disabled) and immediately before the suite that holds the DocDB lifecycle (which needs it enabled), derived from the
 *     suites' own file lists; the DocDB allowlist is gone from the module; the gates job runs `pnpm check:live-guards`
 *     after the epics-sync check;
 *   - the real `ci.yml`, parsed: the same order by step name, and a mutation of the workflow text for each way the step can be
 *     dropped, moved, duplicated or weakened, which `workflowProblems` must report;
 *   - the session script, statically: Modify, then Get, then a one-line failure exit that cannot run unconditionally, then Halt;
 *   - the step's argv, run for real: `throwaway-iris.mjs session ...` parses the declared command and reads the real script before
 *     it needs docker (it stops at the missing state file).
 *
 * Reads documents and calls pure functions, plus one `node` child that exits before it touches docker: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ciChecks from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT, PACKAGES_DIR, workspacePackageDirs } from "../../../../scripts/lib/live-gate-scan.mjs";
import { workflowProblems, type PackageFacts, type WorkflowContext } from "./ci-workflow-check";

const { DECLARED_STEPS, DOCDB_ENABLE_SCRIPT, LIVE_SUITES, ROOT_GATE_SCRIPTS, SEEDED_SUITE_IDS } = ciChecks as unknown as {
  DECLARED_STEPS: Record<string, Array<{ run: string; if?: string; id?: string; workingDirectory?: string }>>;
  DOCDB_ENABLE_SCRIPT: string;
  LIVE_SUITES: Record<string, { allowedSkips: Array<{ file: string; test: string; reason: string }>; expectedFiles: () => string[] }>;
  ROOT_GATE_SCRIPTS: string[];
  SEEDED_SUITE_IDS: string[];
};

const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");
const workflowText = readFileSync(WORKFLOW, "utf8");
const scriptPath = path.join(REPO_ROOT, DOCDB_ENABLE_SCRIPT);
const scriptText = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

function realContext(): WorkflowContext {
  const root = readJson<{ engines?: { node?: string }; packageManager?: string }>(path.join(REPO_ROOT, "package.json"));
  const packages: PackageFacts[] = workspacePackageDirs().map((dir: string) => {
    const manifest = readJson<{ name: string; engines?: { node?: string }; scripts?: Record<string, string> }>(path.join(PACKAGES_DIR, dir, "package.json"));
    return { dir, short: manifest.name.replace(/^@iris-mcp\//, ""), enginesNode: manifest.engines?.node, prepublishOnly: manifest.scripts?.prepublishOnly };
  });
  return { rootEnginesNode: root.engines?.node, packageManager: root.packageManager, packages };
}
const context = realContext();

/** `source` with the one occurrence of `from` replaced; it fails when `from` is not in the text exactly once, so a mutation cannot change nothing. */
function mutate(source: string, from: string, to: string): string {
  expect(source.split(from).length - 1, `the text to replace occurs once: ${from.slice(0, 60)}`).toBe(1);
  return source.replace(from, to);
}

const ENABLE_BLOCK =
  "      - name: enable %Service_DocDB\n" +
  "        if: \"${{ !cancelled() && steps.seed.outcome == 'success' }}\"\n" +
  "        run: node scripts/throwaway-iris.mjs session --state ${{ runner.temp }}/throwaway-live.json --namespace %SYS --script scripts/ci-enable-docdb-service.script\n";
const PREPUBLISH_ALL_HEAD = "      - name: suite prepublish-all\n";
const INTEGRATION_DATA_HEAD = "      - name: suite integration-data\n";
const INTEGRATION_DEV_HEAD = "      - name: suite integration-dev\n";

const throwawaySteps = DECLARED_STEPS["throwaway"] as Array<{ run: string; if?: string; id?: string }>;
const runIndex = (suffix: string): number => throwawaySteps.findIndex((step) => step.run.endsWith(suffix));
const suiteStep = (id: string): number => runIndex(`ci-live-suite.mjs ${id}`);

describe("the registry: where the enable step sits, derived from the suites' own files (AC 44.5.2)", () => {
  /** The suites whose expected files include `file`. */
  const suitesHolding = (file: string): string[] => Object.keys(LIVE_SUITES).filter((id) => LIVE_SUITES[id]?.expectedFiles().some((candidate) => candidate.endsWith(file)));
  const enable = throwawaySteps.findIndex((step) => step.run.includes(DOCDB_ENABLE_SCRIPT));

  // mutation: set DOCDB_ENABLE_BEFORE to 'prepublish-all' in ci-checks.mjs -> the F5 suite runs after the enable step and this goes red.
  it("every suite that holds the Epic 35 F5 gate runs before the enable step (F5 needs the service disabled, else it is an unlisted skip)", () => {
    const holders = suitesHolding("epic35-defect-gate.test.ts");

    expect(holders, "the F5 gate file is in an armed suite").not.toEqual([]);
    expect(enable, "the enable step is declared").toBeGreaterThan(-1);
    for (const id of holders) {
      expect(SEEDED_SUITE_IDS, `${id} is a seeded suite`).toContain(id);
      expect(suiteStep(id), `${id} runs before the enable step`).toBeLessThan(enable);
    }
  });

  // mutation: set DOCDB_ENABLE_BEFORE to 'integration-dev' -> the DocDB lifecycle suite runs before the service is enabled and this goes red.
  it("the suite that holds the DocDB lifecycle runs immediately after the enable step, and no suite that needs the service runs before it", () => {
    const holders = suitesHolding("data.integration.test.ts");

    expect(holders).toEqual(["integration-data"]);
    expect(suiteStep("integration-data")).toBe(enable + 1);
    expect(throwawaySteps[enable + 1]?.run).toMatch(/ci-live-suite\.mjs integration-data$/);
  });

  // mutation: drop the `if: IF_SEED` of the enable step in buildDeclaredSteps -> it would run (and fail) on a job whose seed failed, hiding the real failure.
  it("the step carries the same condition as the suite steps around it, no id, and is the only step that runs the script", () => {
    const step = throwawaySteps[enable];
    const before = throwawaySteps[enable - 1];
    const after = throwawaySteps[enable + 1];

    expect(step?.if).toBeDefined();
    expect(step?.if).toBe(before?.if);
    expect(step?.if).toBe(after?.if);
    expect(step?.id).toBeUndefined();
    expect(throwawaySteps.filter((candidate) => candidate.run.includes(DOCDB_ENABLE_SCRIPT))).toHaveLength(1);
    expect(step?.run).toBe(
      `node scripts/throwaway-iris.mjs session --state \${{ runner.temp }}/throwaway-live.json --namespace %SYS --script ${DOCDB_ENABLE_SCRIPT}`,
    );
  });

  // mutation: change DOCDB_ENABLE_SCRIPT to a name that is not on disk -> this goes red.
  it("the script the step names is a file in the repository, under scripts/", () => {
    expect(DOCDB_ENABLE_SCRIPT).toBe("scripts/ci-enable-docdb-service.script");
    expect(existsSync(scriptPath)).toBe(true);
  });

  // mutation: restore `export const DOCDB_SKIPS` (and a non-empty `allowedSkips` for integration-data) in ci-checks.mjs -> this goes red.
  it("the DocDB allowlist is gone from the registry module, and no suite other than prepublish-all allows a skip", () => {
    expect("DOCDB_SKIPS" in ciChecks).toBe(false);
    expect("DOCDB_REASON" in ciChecks).toBe(false);
    // The baseline constants were not exported, so the module's source is read as well.
    expect(readFileSync(path.join(REPO_ROOT, "scripts", "lib", "ci-checks.mjs"), "utf8")).not.toMatch(/\bDOCDB_(?:SKIPS|REASON)\b/);
    expect(LIVE_SUITES["integration-data"]?.allowedSkips).toEqual([]);
    const withSkips = Object.keys(LIVE_SUITES).filter((id) => (LIVE_SUITES[id]?.allowedSkips.length ?? 0) > 0);
    expect(withSkips).toEqual(["prepublish-all"]);
  });
});

describe("the gates job runs the live-guard check after the epics-sync check (AC 44.5.3)", () => {
  // mutation: delete 'pnpm check:live-guards' from ROOT_GATE_SCRIPTS -> this goes red; move it before the epics-sync check -> the order row goes red.
  it("`pnpm check:live-guards` is a gates step, immediately after `node scripts/check-epics-sync.mjs`, before the launcher steps, and the root script exists", () => {
    const gates = DECLARED_STEPS["gates"] as Array<{ run: string; workingDirectory?: string }>;
    const runs = gates.map((step) => step.run);
    const at = runs.indexOf("pnpm check:live-guards");

    expect(at).toBeGreaterThan(-1);
    expect(runs.filter((run) => run === "pnpm check:live-guards")).toHaveLength(1);
    expect(runs[at - 1]).toBe("node scripts/check-epics-sync.mjs");
    expect(gates[at]?.workingDirectory).toBeUndefined();
    expect(gates.findIndex((step) => step.workingDirectory !== undefined)).toBeGreaterThan(at);
    expect(ROOT_GATE_SCRIPTS.at(-1)).toBe("pnpm check:live-guards");
    expect(readJson<{ scripts: Record<string, string> }>(path.join(REPO_ROOT, "package.json")).scripts["check:live-guards"]).toBe("node scripts/check-live-guards.mjs");
  });
});

describe("the real ci.yml, parsed, and a mutation of it for each way the enable step can be lost", () => {
  type Step = { name?: string; if?: string; run?: string };
  const jobs = (parse(workflowText) as { jobs: Record<string, { steps: Step[] }> }).jobs;
  const names = (job: string): Array<string | undefined> => (jobs[job]?.steps ?? []).map((step) => step.name);

  it("the throwaway job runs prepublish-all, then the enable step, then integration-data directly after it; no other job has the step", () => {
    const steps = names("throwaway");
    const enable = steps.indexOf("enable %Service_DocDB");

    expect(enable).toBeGreaterThan(-1);
    expect(steps.indexOf("suite prepublish-all")).toBeGreaterThan(-1);
    expect(steps.indexOf("suite prepublish-all")).toBeLessThan(enable);
    expect(steps[enable + 1]).toBe("suite integration-data");
    for (const job of Object.keys(jobs).filter((id) => id !== "throwaway")) {
      expect((jobs[job]?.steps ?? []).filter((step) => (step.run ?? "").includes("ci-enable-docdb-service")), `${job} does not run the script`).toEqual([]);
    }
  });

  it("the gates job runs `live-guard check` directly after `epics sync check`, as the plain command (not an `|| true`, not a `continue-on-error`)", () => {
    const gates = jobs["gates"]?.steps ?? [];
    const at = gates.findIndex((step) => step.name === "live-guard check");

    expect(at).toBeGreaterThan(0);
    expect(gates[at - 1]?.name).toBe("epics sync check");
    expect(gates[at]?.run).toBe("pnpm check:live-guards");
    expect(Object.keys(gates[at] as object).sort()).toEqual(["name", "run"]);
  });

  it("the real workflow has no problem (the baseline of every row below)", () => {
    expect(workflowProblems(workflowText, context)).toEqual([]);
  });

  // mutation: delete the `enable %Service_DocDB` step from ci.yml -> the first row and the two tests above go red.
  it.each([
    ["the enable step dropped", () => mutate(workflowText, ENABLE_BLOCK, ""), /declared step is not in the workflow.*ci-enable-docdb-service\.script/],
    [
      "the enable step moved before the prepublish-all suite (F5 would skip)",
      () => mutate(mutate(workflowText, ENABLE_BLOCK, ""), PREPUBLISH_ALL_HEAD, ENABLE_BLOCK + PREPUBLISH_ALL_HEAD),
      /throwaway: step \d+ is out of order/,
    ],
    [
      "the enable step moved after the integration-data suite (the lifecycle would skip)",
      () => mutate(mutate(workflowText, ENABLE_BLOCK, ""), INTEGRATION_DEV_HEAD, ENABLE_BLOCK + INTEGRATION_DEV_HEAD),
      /throwaway: step \d+ is out of order/,
    ],
    [
      "the enable step moved one suite earlier (before integration-admin, not immediately before integration-data)",
      () => mutate(mutate(workflowText, ENABLE_BLOCK, ""), "      - name: suite integration-admin\n", ENABLE_BLOCK + "      - name: suite integration-admin\n"),
      /throwaway: step \d+ is out of order/,
    ],
    [
      "the enable step duplicated",
      () => mutate(workflowText, ENABLE_BLOCK, ENABLE_BLOCK + ENABLE_BLOCK),
      /the workflow has a step the registry does not declare.*ci-enable-docdb-service\.script/,
    ],
    [
      "the enable step without its condition",
      () => mutate(workflowText, ENABLE_BLOCK, ENABLE_BLOCK.replace(/ {8}if: .*\n/, "")),
      /declared step is not in the workflow.*ci-enable-docdb-service\.script/,
    ],
    [
      "the enable step in another namespace",
      () => mutate(workflowText, "--namespace %SYS --script scripts/ci-enable-docdb-service.script", "--namespace HSCUSTOM --script scripts/ci-enable-docdb-service.script"),
      /declared step is not in the workflow.*ci-enable-docdb-service\.script/,
    ],
    [
      "the enable step pointed at another script",
      () => mutate(workflowText, "--script scripts/ci-enable-docdb-service.script", "--script scripts/ci-enable-other.script"),
      /declared step is not in the workflow.*ci-enable-docdb-service\.script/,
    ],
    [
      "the live-guard check moved before the epics-sync check",
      () =>
        mutate(
          workflowText,
          "      - name: epics sync check\n        run: node scripts/check-epics-sync.mjs\n      - name: live-guard check\n        run: pnpm check:live-guards\n",
          "      - name: live-guard check\n        run: pnpm check:live-guards\n      - name: epics sync check\n        run: node scripts/check-epics-sync.mjs\n",
        ),
      /gates: step \d+ is out of order/,
    ],
    [
      "the live-guard check weakened to a command that cannot fail the job",
      () => mutate(workflowText, "        run: pnpm check:live-guards\n", "        run: pnpm check:live-guards || true\n"),
      /declared step is not in the workflow.*check:live-guards/,
    ],
  ] as Array<[string, () => string, RegExp]>)("fails on %s, naming the difference", (_label, apply, expected) => {
    expect(workflowProblems(apply(), context).join("\n")).toMatch(expected);
  });

  it("every mutation row above changes the text it claims to (a row that changes nothing would pass for the wrong reason)", () => {
    expect(workflowText.split(ENABLE_BLOCK).length - 1).toBe(1);
    expect(workflowText.indexOf(PREPUBLISH_ALL_HEAD)).toBeLessThan(workflowText.indexOf(ENABLE_BLOCK));
    expect(workflowText.indexOf(ENABLE_BLOCK) + ENABLE_BLOCK.length).toBe(workflowText.indexOf(INTEGRATION_DATA_HEAD));
  });
});

describe("the session script, statically (AC 44.5.2, DW-726)", () => {
  const lines = scriptText.split("\n");
  const code = lines.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith(";"));
  const at = (pattern: RegExp): number => code.findIndex((line) => pattern.test(line));

  // mutation: comment out the `Modify` line of the script -> this goes red (a live run would exit 1 at the read-back).
  it("sets Enabled=1, calls Security.Services Modify on %Service_DocDB, then Get on the same service, in that order", () => {
    const props = at(/^Set tProps\("Enabled"\)\s*=\s*1$/);
    const modify = at(/^Set tModify\s*=\s*##class\(Security\.Services\)\.Modify\("%Service_DocDB",\s*\.tProps\)$/);
    const get = at(/^Set tGet\s*=\s*##class\(Security\.Services\)\.Get\("%Service_DocDB",\s*\.tRead\)$/);

    expect(props, "the property is set").toBeGreaterThan(-1);
    expect(modify, "Modify is called").toBeGreaterThan(props);
    expect(get, "Get is called after Modify").toBeGreaterThan(modify);
  });

  // mutation: delete the `Set (tModify,tGet)=0` line -> this goes red (a Modify that raises an error would leave tModify undefined, the If
  // line would raise <UNDEFINED> before its Terminate, and the Halt would end the session with exit 0).
  it("starts the two results at 0 before the Modify, so an error raised by Modify or Get still reaches the Terminate", () => {
    const init = at(/^Set \(tModify,tGet\)=0$/);

    expect(init, "the results are initialised").toBeGreaterThan(-1);
    expect(init).toBeLessThan(at(/\.Modify\("%Service_DocDB"/));
  });

  // mutation: change one of the three service names to `%Service_DocDb` (or add a second service) -> this goes red.
  it("names exactly one service, spelled `%Service_DocDB`, and touches nothing else", () => {
    const services = scriptText.match(/%Service_\w+/g) ?? [];

    expect(services.length).toBeGreaterThanOrEqual(2);
    expect(new Set(services)).toEqual(new Set(["%Service_DocDB"]));
    expect(code.filter((line) => /\b(Kill|ZKill|ZN|ZNSpace)\b|\$NAMESPACE|\$ZNSPACE/i.test(line))).toEqual([]);
    expect(code.filter((line) => /##class\(/.test(line)).every((line) => /##class\(Security\.Services\)\.(Modify|Get)\(/.test(line))).toBe(true);
  });

  // mutation: drop the read-back (the Get) from the marker line, or its `Enabled=` text -> this goes red.
  it("writes one marker line with the read-back (modify, get and Enabled values) after the Get", () => {
    const get = at(/\.Get\("%Service_DocDB"/);
    const marker = at(/^Write "ci-enable-docdb-service: modify=",tModify," get=",tGet," Enabled=",\$Get\(tRead\("Enabled"\)\),!$/);

    expect(marker).toBeGreaterThan(get);
  });

  // mutation: remove one of the three operands of the failure condition, or put the Terminate on its own line (it would then run unconditionally) -> this goes red.
  it("fails (a non-zero Terminate) unless Modify, Get and the read-back are all OK, and the Terminate is on the SAME line as its If", () => {
    const failure = at(/^If\s/);
    const line = code[failure] ?? "";

    expect(failure, "the failure check is after the Get").toBeGreaterThan(at(/\.Get\("%Service_DocDB"/));
    expect(line).toContain("(tModify'=1)");
    expect(line).toContain("(tGet'=1)");
    expect(line).toContain(`($Get(tRead("Enabled"))'=1)`);
    // ObjectScript evaluates left to right with no precedence: every operand is parenthesised and the three are joined by `||`.
    expect(line).toMatch(/^If \(tModify'=1\)\|\|\(tGet'=1\)\|\|\(\$Get\(tRead\("Enabled"\)\)'=1\) /);
    expect(line).toContain("FAILED");
    const terminate = /\$SYSTEM\.Process\.Terminate\(,\s*(\d+)\)/.exec(line);
    expect(terminate, "Terminate is on the If line").not.toBeNull();
    expect(Number(terminate?.[1])).toBeGreaterThan(0);
    expect(code.filter((candidate) => candidate.includes("Terminate")), "the only Terminate is the one on the If line").toEqual([line]);
  });

  // mutation: delete the final `Halt` -> this goes red (the session would wait for more input until the step's timeout).
  it("ends with exactly one Halt, after the failure check, and the file ends with a newline", () => {
    expect(code.at(-1)).toBe("Halt");
    expect(code.filter((line) => /^Halt\b/i.test(line))).toHaveLength(1);
    expect(code.indexOf("Halt")).toBeGreaterThan(at(/^If\s/));
    expect(scriptText.endsWith("\n")).toBe(true);
  });

  // mutation: wrap a command in a `{ ... }` block spread over several lines -> this goes red (a terminal session reads one command per line).
  it("is one terminal command per line: no block, no continuation, no tab, every comment line starts with `;` in column 0", () => {
    expect(code.filter((line) => /[{}]/.test(line))).toEqual([]);
    expect(scriptText).not.toMatch(/\t/);
    expect(lines.filter((line) => line.trim().startsWith(";")).every((line) => line.startsWith(";"))).toBe(true);
    expect(code.length).toBeLessThan(10);
  });
});

describe("the step's argv, run for real: the declared command parses and the script is read before docker is needed (AC 44.5.2)", () => {
  const declared = (DECLARED_STEPS["throwaway"] as Array<{ run: string }>).map((step) => step.run).find((run) => run.includes(DOCDB_ENABLE_SCRIPT)) as string;
  const missingState = path.join(tmpdir(), "story-44-5-qa-no-such-dir", "throwaway-live.json");
  // The state path is put in after the split, so a temporary directory with a space in it stays one argument.
  const argvFor = (run: string): string[] =>
    run
      .replace("${{ runner.temp }}/throwaway-live.json", "STATE-FILE")
      .split(/\s+/)
      .slice(1)
      .map((arg) => (arg === "STATE-FILE" ? missingState : arg));
  const runNode = (argv: string[]) => spawnSync(process.execPath, argv, { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, IRIS_REQUIRE_LIVE: "" } });

  // mutation: point DOCDB_ENABLE_SCRIPT at a name that is not on disk, or drop `--namespace` from the declared command -> the stderr is not the missing-state message and this goes red.
  it("the declared command reaches the state-file check (exit 2, 'does not exist'), so its flags parse and the real script was read", () => {
    const run = runNode(argvFor(declared));

    expect(run.status, run.stdout + run.stderr).toBe(2);
    expect(run.stderr).toContain("the state file");
    expect(run.stderr).toContain("does not exist");
    expect(run.stderr).not.toMatch(/ENOENT|--script|namespace/i);
  });

  it("the same command with a script that is not on disk stops earlier, naming the file (so the row above proves the real script was read)", () => {
    const run = runNode(argvFor(declared.replace(DOCDB_ENABLE_SCRIPT, "scripts/ci-enable-no-such.script")));

    expect(run.status, run.stdout + run.stderr).toBe(2);
    expect(run.stderr).toMatch(/ENOENT/);
    expect(run.stderr).toContain("ci-enable-no-such.script");
  });
});
