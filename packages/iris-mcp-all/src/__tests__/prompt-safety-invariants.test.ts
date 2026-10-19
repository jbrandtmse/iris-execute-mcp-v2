/**
 * Story 25.1 QA — safety-invariant content guards on the SAFETY-critical
 * prompts (AC 25.1.1, Rule #17, Rule #35).
 *
 * ORTHOGONAL to `validate-prompts.test.ts` (which only checks that every
 * `iris_*` TOKEN resolves to a real tool name — it says nothing about
 * ORDERING, wording, or safety semantics) and to
 * `readonly-hint-crosscheck.test.ts` (governance classification, unrelated).
 * The story's own escalation-ladder / double-gate / thaw-always / total-count
 * / word-count invariants are exactly the kind of thing a future content
 * edit could silently break while every existing test stays green (the
 * tool-name tokens would still resolve; only the SAFETY semantics would
 * regress). These tests pin the exact safety-critical semantics called out
 * in Task 1 / Dev Notes so an edit to the prompt body that drops or
 * reorders a safety instruction fails CI.
 *
 * Uses the SAME `loadAllPrompts` catalog loader (built-dist import) that
 * `validate-prompts.test.ts` uses, so it requires the same prior
 * `pnpm turbo run build` (already a `test` task dependency via turbo).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

interface LoadedPrompt {
  pkg: string;
  prompt: {
    name: string;
    title: string;
    description: string;
    build: (args: Record<string, string | undefined>) => string;
  };
}

async function findPrompt(name: string): Promise<LoadedPrompt> {
  const prompts = (await loadAllPrompts(root)) as LoadedPrompt[];
  const found = prompts.find((p) => p.prompt.name === name);
  if (!found) {
    throw new Error(`Prompt "${name}" not found among registered prompts.`);
  }
  return found;
}

describe("recover-stuck-production — recover-first / clean-last-resort / killAppData double-gate (Epic-20 escalation ladder)", () => {
  it("instructs 'recover' strictly BEFORE 'clean' in the escalation ladder", async () => {
    const { pkg, prompt } = await findPrompt("recover-stuck-production");
    expect(pkg).toBe("iris-interop-mcp");
    const body = prompt.build({});

    const recoverIdx = body.indexOf("action 'recover'");
    const cleanIdx = body.indexOf("action 'clean'");
    expect(recoverIdx).toBeGreaterThan(-1);
    expect(cleanIdx).toBeGreaterThan(-1);
    expect(recoverIdx).toBeLessThan(cleanIdx);
  });

  it("names 'clean' as a last resort only after 'recover' has been tried", async () => {
    const { prompt } = await findPrompt("recover-stuck-production");
    const body = prompt.build({});
    expect(body).toMatch(/Only if still wedged after ['"]?recover['"]?/i);
    expect(body.toLowerCase()).toContain("last resort");
  });

  it("carries the killAppData explicit-data-loss-acceptance double confirmation gate", async () => {
    const { prompt } = await findPrompt("recover-stuck-production");
    const body = prompt.build({});

    // NEVER-suggest-without-explicit-acceptance wording.
    expect(body).toMatch(/NEVER suggest `?killAppData/i);
    // Both flags required together (the "double" in double-gate).
    expect(body).toContain("killAppData: true");
    expect(body).toContain("confirm: true");
    expect(body.toLowerCase()).toContain("double confirmation gate");
    // Explains the concrete data-loss consequence, not just a bare warning.
    expect(body).toContain("PERSISTENT");
    expect(body).toContain("Ens.AppData");
  });
});

describe("resend-failed-messages — dry-run-first workflow + duplication hazard + default-disabled write (Story 26.3)", () => {
  it("renders the dry-run-first workflow naming both real tools, with dryRun:true preview strictly before dryRun:false/confirm:true execution", async () => {
    const { pkg, prompt } = await findPrompt("resend-failed-messages");
    expect(pkg).toBe("iris-interop-mcp");
    const body = prompt.build({ item: "MyItem", since: "2026-07-01" });

    expect(body).toContain("iris_message_resend");
    expect(body).toContain("iris_production_messages");
    expect(body).toContain("DRY-RUN-FIRST");

    const previewIdx = body.indexOf("dryRun: true");
    const executeIdx = body.indexOf("dryRun: false");
    const confirmIdx = body.indexOf("confirm: true");
    expect(previewIdx).toBeGreaterThan(-1);
    expect(executeIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(previewIdx).toBeLessThan(executeIdx);
    expect(executeIdx).toBeLessThan(confirmIdx);
  });

  it("states the duplication hazard and that resend/resendFiltered are governance-default-disabled writes, with the enable snippet", async () => {
    const { prompt } = await findPrompt("resend-failed-messages");
    const body = prompt.build({ item: "MyItem", since: "2026-07-01" });

    expect(body).toContain("DUPLICATION HAZARD");
    expect(body).toContain("DEFAULT-DISABLED");
    expect(body).toContain("GOVERNANCE_DISABLED");
    expect(body).toContain("IRIS_GOVERNANCE");
  });

  it("both required args interpolate into the rendered body; omitting both renders bracketed placeholders without throwing", async () => {
    const { prompt } = await findPrompt("resend-failed-messages");

    const filled = prompt.build({
      item: "SessionAgent.Sample.BS.OrderIngest",
      since: "2026-07-01T00:00:00Z",
    });
    expect(filled).toContain("SessionAgent.Sample.BS.OrderIngest");
    expect(filled).toContain("2026-07-01T00:00:00Z");

    expect(() => prompt.build({})).not.toThrow();
    const empty = prompt.build({});
    expect(empty).toContain("<item>");
    expect(empty).toContain("<since>");
  });
});

describe("promote-environment-change — review-before-write diff -> plan -> execute -> re-diff + no-deletions guarantee (Story 27.4)", () => {
  it("renders the review-before-write workflow naming both real tools, with diff -> plan -> execute -> re-diff verify in order", async () => {
    const { pkg, prompt } = await findPrompt("promote-environment-change");
    expect(pkg).toBe("iris-dev-mcp");
    const body = prompt.build({ source: "stage", target: "prod" });

    expect(body).toContain("iris_env_diff");
    expect(body).toContain("iris_env_promote");

    const planIdx = body.indexOf('action: "plan"');
    const executeIdx = body.indexOf('action: "execute"');
    const verifyIdx = body.lastIndexOf("iris_env_diff");
    expect(planIdx).toBeGreaterThan(-1);
    expect(executeIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(executeIdx);
    // The re-diff verify step (step 5) references iris_env_diff again, AFTER
    // the execute call -- the LAST occurrence of the token must come after
    // "execute", proving the workflow re-verifies rather than stopping at
    // the write.
    expect(executeIdx).toBeLessThan(verifyIdx);
  });

  it("states the no-deletions guarantee for onlyInTarget items and the credential-redaction / secrets-exclusion promise", async () => {
    const { prompt } = await findPrompt("promote-environment-change");
    const body = prompt.build({ source: "stage", target: "prod" });

    expect(body.toLowerCase()).toContain("never propose or attempt to remove");
    expect(body).toContain("onlyInTarget");
    expect(body).toContain("REDACTED");
    expect(body.toLowerCase()).toContain("out of scope entirely");
  });

  it("states execute is governance-default-disabled (calling-profile tool key), with the enable snippet", async () => {
    const { prompt } = await findPrompt("promote-environment-change");
    const body = prompt.build({ source: "stage", target: "prod" });

    expect(body).toContain("DEFAULT-DISABLED");
    expect(body).toContain("GOVERNANCE_DISABLED");
    expect(body).toContain("IRIS_GOVERNANCE");
    expect(body).toContain('"iris_env_promote:execute": true');
  });

  it("both required args interpolate into the rendered body; the optional spec arg omitted renders bracketed placeholders without throwing", async () => {
    const { prompt } = await findPrompt("promote-environment-change");

    const filled = prompt.build({ source: "stage", target: "prod" });
    expect(filled).toContain("stage");
    expect(filled).toContain("prod");

    expect(() => prompt.build({})).not.toThrow();
    const empty = prompt.build({});
    expect(empty).toContain("<source>");
    expect(empty).toContain("<target>");
  });

  it("encodes the user-review step and the explicit step allowlist, with confirm:true gating the execute call, in full order (AC 27.4.4)", async () => {
    // The existing "diff -> plan -> execute -> re-diff verify in order" test
    // above does not check WHERE the user-review step, the explicit step
    // allowlist, or `confirm: true` fall relative to those four anchors. This
    // pins the FULL ordered workflow the spec requires: scoped diff -> review
    // WITH the user -> plan -> explicit step allowlist -> execute gated by
    // confirm:true -> re-diff verify.
    const { prompt } = await findPrompt("promote-environment-change");
    const body = prompt.build({ source: "stage", target: "prod" });

    const checks: Array<[string, number]> = [
      // Anchor on the numbered step-1 marker ("1. Call"), NOT the raw
      // "iris_env_diff" token: the FIRST "iris_env_diff" occurrence is the
      // GOVERNANCE preamble mention ("its sibling `plan`, and `iris_env_diff`
      // itself, are reads"), which sits above step 1 and would make this
      // anchor trivially-true regardless of where the step-1 diff call lands.
      ["initial iris_env_diff call (step 1)", body.indexOf("1. Call")],
      ["review-with-user step", body.indexOf("Review the diff report WITH the user")],
      ["plan action", body.indexOf('action: "plan"')],
      ["explicit step allowlist", body.indexOf("EXPLICIT list of step indices")],
      ["execute action", body.indexOf('action: "execute"')],
      ["confirm:true", body.indexOf("confirm: true")],
      ["re-diff verify", body.lastIndexOf("iris_env_diff")],
    ];

    for (const [label, idx] of checks) {
      expect(idx, `"${label}" not found in rendered body`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < checks.length; i++) {
      const [prevLabel, prevIdx] = checks[i - 1];
      const [label, idx] = checks[i];
      expect(prevIdx, `"${prevLabel}" should precede "${label}"`).toBeLessThan(idx);
    }
  });

  it("the optional spec arg, when PROVIDED, renders the spec-aware guidance branch, not the generic omitted-spec example (Rule #47)", async () => {
    // The other tests in this block only ever call build({source, target})
    // (spec omitted), so the isArgProvided(args.spec) TRUE branch of
    // specGuidance is otherwise never exercised by this suite.
    const { prompt } = await findPrompt("promote-environment-change");
    const body = prompt.build({ source: "stage", target: "prod", spec: "MyApp.*.cls,*.mac" });

    expect(body).toContain("stage");
    expect(body).toContain("prod");
    // The spec-PROVIDED branch interpolates the value directly into the
    // guidance sentence...
    expect(body).toContain('spec: "MyApp.*.cls,*.mac"');
    // ...and must NOT fall back to the omitted-spec branch's generic example
    // wording -- proves the correct (isArgProvided) branch rendered.
    expect(body).not.toContain("No `spec` is needed for the four domains listed above.");
  });
});

describe("run-external-backup — thaw ALWAYS even on failure + journaling-resumed verification", () => {
  it("declares the never-left-frozen safety invariant up front", async () => {
    const { pkg, prompt } = await findPrompt("run-external-backup");
    expect(pkg).toBe("iris-ops-mcp");
    const body = prompt.build({});
    expect(body.toLowerCase()).toContain("must never be left frozen");
  });

  it("instructs thaw to run ALWAYS, regardless of snapshot outcome, and retry-on-failure", async () => {
    const { prompt } = await findPrompt("run-external-backup");
    const body = prompt.build({});
    expect(body).toMatch(/\*\*Always\*\*,\s*regardless of whether the snapshot succeeded/i);
    expect(body.toLowerCase()).toContain("retry immediately");
    expect(body.toLowerCase()).toContain("must not be left frozen");
  });

  it("verifies journaling has resumed AFTER the thaw step (freeze -> snapshot -> thaw -> verify ordering)", async () => {
    const { prompt } = await findPrompt("run-external-backup");
    const body = prompt.build({});

    const freezeIdx = body.indexOf("action 'freeze'");
    const thawIdx = body.indexOf("action 'thaw'");
    const verifyIdx = body.search(/journal(?:ing)? has resumed/i);

    expect(freezeIdx).toBeGreaterThan(-1);
    expect(thawIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(freezeIdx).toBeLessThan(thawIdx);
    expect(thawIdx).toBeLessThan(verifyIdx);
  });
});

describe("deploy-and-test-class — glob-path guidance (Rule #17) + total-count check (Rule #35)", () => {
  it("instructs a glob-prefixed path, warning that a bare path's upload is refused (Story 35.9 refusal contract; ledger 35-9-DEV-2)", async () => {
    const { pkg, prompt } = await findPrompt("deploy-and-test-class");
    expect(pkg).toBe("iris-dev-mcp");
    const body = prompt.build({ classOrPackage: "MyApp.MyClass" });

    expect(body.toLowerCase()).toContain("glob-prefixed path");
    // Post-35.9 the loader REFUSES a bare path whose derived name disagrees
    // with the file's Class declaration — the warning must name the refusal,
    // not the stale "mis-maps the class name" phrasing.
    expect(body.toLowerCase()).toContain("refused");
    expect(body.toLowerCase()).not.toContain("mis-maps the class name");
    // Concrete glob shape guidance, not just an abstract warning.
    expect(body).toMatch(/\*\*\/\*\.cls|\*\*\/<ClassName>\.cls/);
  });

  it("instructs comparing the returned `total` against the expected test count before trusting a green run", async () => {
    const { prompt } = await findPrompt("deploy-and-test-class");
    const body = prompt.build({ classOrPackage: "MyApp.MyClass" });

    expect(body).toMatch(/returned `total`/);
    expect(body.toLowerCase()).toContain("partial");
    expect(body.toLowerCase()).toContain("rerun");
  });
});

describe("objectscript-review — <=300 word rendered body (AC 25.1.1)", () => {
  it("has no arguments and renders a body of at most 300 words", async () => {
    const { pkg, prompt } = await findPrompt("objectscript-review");
    expect(pkg).toBe("iris-dev-mcp");

    const body = prompt.build({});
    // Word count = whitespace-separated tokens containing at least one
    // alphanumeric character. Bare markdown punctuation tokens (a lone "-"
    // list-bullet marker, a standalone "→"/"—" separator) are NOT prose
    // words by any conventional word-count definition (a naive
    // whitespace-only split over-counts by ~39 words on this body, purely
    // from list-bullet "-" markers — confirmed by direct measurement against
    // the built prompt content).
    const wordCount = body
      .trim()
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w)).length;

    expect(wordCount).toBeGreaterThan(0);
    expect(wordCount).toBeLessThanOrEqual(300);
  });

  it("distills the core ObjectScript conventions the spec names", async () => {
    const { prompt } = await findPrompt("objectscript-review");
    const body = prompt.build({});

    for (const marker of [
      "$$$",
      "underscore",
      "Try/Catch",
      "%OnNew",
      "Storage",
      "iris_doc_load",
      "iris_execute_tests",
    ]) {
      expect(body).toContain(marker);
    }
  });
});

describe("edit-and-test-class and deploy-and-test-class - the in-place edit loop (Story 38.6)", () => {
  const EDIT_ARGS = { className: "MyApp.Orders", change: "Rename a property", testClass: "MyApp.Tests.OrdersTest" };
  const OMITTED_ARGS = { className: "MyApp.Orders", change: "Rename a property" };

  /** Every rendering of the two prompts: all arguments given, an optional one omitted, and the skill form. */
  async function renderings(): Promise<Array<{ label: string; body: string }>> {
    const edit = (await findPrompt("edit-and-test-class")).prompt;
    const deploy = (await findPrompt("deploy-and-test-class")).prompt;
    return [
      { label: "edit-and-test-class (all arguments)", body: edit.build(EDIT_ARGS) },
      { label: "edit-and-test-class (testClass omitted)", body: edit.build(OMITTED_ARGS) },
      { label: "edit-and-test-class (skill form)", body: edit.build({}) },
      { label: "deploy-and-test-class", body: deploy.build({ classOrPackage: "MyApp.MyClass" }) },
      { label: "deploy-and-test-class (skill form)", body: deploy.build({}) },
    ];
  }

  it("edit-and-test-class is a dev prompt that reads a range, edits with expected, compiles, tests and checks the total, in that order", async () => {
    const { pkg, prompt } = await findPrompt("edit-and-test-class");
    expect(pkg).toBe("iris-dev-mcp");
    for (const args of [EDIT_ARGS, OMITTED_ARGS, {}]) {
      const body = prompt.build(args);
      const steps = [
        "`startLine` / `endLine`",
        "`iris_doc_edit` with `action: \"apply\"`",
        "`iris_doc_compile`",
        "`iris_execute_tests`",
        "number of `Test*` methods",
        "`unifiedDiff`",
      ];
      const at = steps.map((step) => body.indexOf(step));
      expect(at.every((index) => index > -1), JSON.stringify(args)).toBe(true);
      expect([...at].sort((a, b) => a - b), JSON.stringify(args)).toEqual(at);
      expect(body.indexOf("`iris_doc_get`")).toBeLessThan(body.indexOf("`iris_doc_edit`"));
    }
  });

  it("builds expected from the read's lines with a line break after every line, the last included", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    const body = prompt.build(OMITTED_ARGS);
    expect(body).toContain("Build each edit's `expected` from the read's `lines`");
    expect(body).toContain("every line followed by a line break");
    expect(body).toContain("the last line included");
  });

  it("on STALE_CONTENT passes mismatches[].current back as expected when the change still applies, else re-reads", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    const body = prompt.build(OMITTED_ARGS);
    expect(body).toContain("`STALE_CONTENT`");
    expect(body).toContain("Pass each `mismatches[].current` back as that edit's `expected`, unchanged");
    expect(body).toContain("once your change still applies to that text; otherwise read the lines again");
  });

  it("never regenerates Storage unless the user explicitly asks, and says why", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    const body = prompt.build(OMITTED_ARGS);
    expect(body).toContain("`STORAGE_DROPPED`");
    expect(body).toContain("keep the Storage lines");
    expect(body).toMatch(/Never use action `regenerateStorage` unless the user explicitly asks/);
    expect(body).toContain("disabled by default");
    // The only mention of the override is the prohibition.
    expect(body.match(/regenerateStorage/g)).toHaveLength(1);
  });

  it("stops on GOVERNANCE_DISABLED, re-reads on DOCUMENT_CONFLICT, and warns that a local source file is now stale", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    const body = prompt.build(OMITTED_ARGS);
    expect(body).toMatch(/`GOVERNANCE_DISABLED` refusal[^.]*stop and tell the user/);
    expect(body).toMatch(/`DOCUMENT_CONFLICT` refusal[^.]*read the lines again/);
    expect(body).toContain("out of date because the edit was made in IRIS");
    expect(body).toContain("loading that file again would overwrite the edit");
  });

  it("on a running test result follows the hint and never re-submits; a short total is rerun", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    const body = prompt.build(OMITTED_ARGS);
    expect(body).toContain('`status: "running"`');
    expect(body).toContain("follow the response's `hint`");
    expect(body).toContain("never re-submit the same target");
    expect(body).toContain("compare the returned `total` against the number of `Test*` methods");
    expect(body).toContain("rerun `iris_execute_tests` if `total` is short");
  });

  it("names the test class when given, and otherwise tells the model to find it or ask", async () => {
    const { prompt } = await findPrompt("edit-and-test-class");
    expect(prompt.build(EDIT_ARGS)).toContain('`target: "MyApp.Tests.OrdersTest"`');
    const omitted = prompt.build(OMITTED_ARGS);
    expect(omitted).toContain("find the test class that covers `MyApp.Orders`");
    expect(omitted).toContain("or ask the user which test class to run");
  });

  it("every iris_* token of edit-and-test-class is a dev core tool, and of deploy-and-test-class a dev core tool, iris_test_status or iris_test_coverage", async () => {
    const presets = (await import(
      pathToFileURL(resolve(root, "packages/iris-dev-mcp/dist/tools/presets.js")).href
    )) as { toolPresets: { core: { include: string[] } } };
    const core = new Set(presets.toolPresets.core.include);
    const withTestStatus = new Set([...core, "iris_test_status", "iris_test_coverage"]);
    expect(core.has("iris_doc_edit")).toBe(true);
    expect(core.has("iris_test_status")).toBe(false);
    expect(core.has("iris_test_coverage"), "the coverage tool is outside core, which is why step 8 tells the model what to do when it is hidden").toBe(false);

    for (const { label, body } of await renderings()) {
      const allowed = label.startsWith("edit-and-test-class") ? core : withTestStatus;
      const tokens = [...new Set(body.match(/\biris_[a-z_]+/g) ?? [])];
      expect(tokens.length, label).toBeGreaterThan(0);
      expect(
        tokens.filter((token) => !allowed.has(token)),
        label,
      ).toEqual([]);
    }
  });

  it("carries no internal rule number and no repository path", async () => {
    for (const { label, body } of await renderings()) {
      expect(body, label).not.toMatch(/Rule #\d/);
      expect(body, label).not.toMatch(/iris-execute-mcp-v2|packages\/|_bmad|\.claude|node_modules|research\/|deferred-work|spec-\d/);
    }
  });

  it("deploy-and-test-class sends the manual %UnitTest_Result query to iris_sql_query, never iris_sql_execute", async () => {
    const { prompt } = await findPrompt("deploy-and-test-class");
    const body = prompt.build({ classOrPackage: "MyApp.MyClass" });
    expect(body).toContain("`iris_sql_query` (with `parameters: [<runIndex>]`) joining `%UnitTest_Result.TestMethod`");
    expect(body).toContain("`WHERE ti.InstanceIndex = ?`");
    expect(body).not.toContain("InstanceIndex = <runIndex>");
    expect(body).not.toContain("iris_sql_execute");
  });

  it("deploy-and-test-class fixes a class that has no local source in place, and keeps the disk route for the rest", async () => {
    const { prompt } = await findPrompt("deploy-and-test-class");
    const body = prompt.build({ classOrPackage: "MyApp.MyClass" });
    expect(body).toContain("fix the SOURCE `.cls` file on disk (never edit generated/compiled output)");
    expect(body).toContain("A class that has no local source file (it exists only in IRIS) is fixed in place instead");
    expect(body).toContain("ranged `iris_doc_get`");
    expect(body).toContain("`iris_doc_edit`");
    expect(body).toContain("`iris_doc_compile`");
    expect(body).toContain("`edit-and-test-class`");
    expect(body).toContain(
      "Repeat until `iris_doc_load` (or `iris_doc_compile`, for a class fixed in place) reports zero compile errors.",
    );
  });
});

describe("trace-message-flow and find-patient-messages - the message forensic loop (Story 39.6)", () => {
  const TRACE_ARGS = { sessionOrHeaderId: "7", namespace: "USER" };
  const FIND_ARGS = {
    patientId: "X",
    from: "2001-02-03T00:00:00Z",
    to: "2001-02-04T00:00:00Z",
    searchTableClass: "EnsLib.HL7.SearchTable",
    namespace: "USER",
  };

  /** Every rendering of the two prompts: all arguments given, optional ones omitted, and the skill form. */
  async function renderings(): Promise<Array<{ label: string; name: string; body: string }>> {
    const trace = (await findPrompt("trace-message-flow")).prompt;
    const find = (await findPrompt("find-patient-messages")).prompt;
    return [
      { label: "trace-message-flow (all arguments)", name: "trace-message-flow", body: trace.build(TRACE_ARGS) },
      { label: "trace-message-flow (namespace omitted)", name: "trace-message-flow", body: trace.build({ sessionOrHeaderId: "7" }) },
      { label: "trace-message-flow (skill form)", name: "trace-message-flow", body: trace.build({}) },
      { label: "find-patient-messages (all arguments)", name: "find-patient-messages", body: find.build(FIND_ARGS) },
      { label: "find-patient-messages (patientId only)", name: "find-patient-messages", body: find.build({ patientId: "X" }) },
      { label: "find-patient-messages (skill form)", name: "find-patient-messages", body: find.build({}) },
    ];
  }

  /** Assert each marker is present and the markers appear in the given order. */
  function expectOrdered(label: string, body: string, markers: string[]): void {
    const at = markers.map((marker) => body.indexOf(marker));
    markers.forEach((marker, i) => expect(at[i], `${label}: "${marker}" not found`).toBeGreaterThan(-1));
    expect([...at].sort((a, b) => a - b), label).toEqual(at);
  }

  it("both prompts belong to the interop package", async () => {
    expect((await findPrompt("trace-message-flow")).pkg).toBe("iris-interop-mcp");
    expect((await findPrompt("find-patient-messages")).pkg).toBe("iris-interop-mcp");
  });

  it("trace-message-flow runs messages, header search, body read, diagram, logs and the summary, in that order", async () => {
    for (const { label, name, body } of await renderings()) {
      if (name !== "trace-message-flow") continue;
      expectOrdered(label, body, [
        "1. Call `iris_production_messages`",
        "2. Call `iris_message_search`",
        "3. Call `iris_message_body`",
        "4. Call `iris_message_diagram`",
        "5. For every step flagged as an error",
        "`iris_production_logs`",
        "6. Summarize the failure point",
      ]);
    }
  });

  it("every trace-message-flow rendering reports the reason for withheld error and log text and never reads either another way", async () => {
    let checked = 0;
    for (const { label, name, body } of await renderings()) {
      if (name !== "trace-message-flow") continue;
      expect(body, label).toContain("never read the error text another way");
      expect(body, label).toContain("never read the log text another way");
      expect(body, label).toContain("give its reason instead of the text");
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it("find-patient-messages checks the policy, fixes the window, searches the Search Table, lists, reads, diagrams and reports, in that order", async () => {
    for (const { label, name, body } of await renderings()) {
      if (name !== "find-patient-messages") continue;
      expectOrdered(label, body, [
        "1. Call `iris_server_profiles`",
        "2. Fix the search window",
        '3. Call `iris_message_search` with `action: "searchTable"`',
        "4. List the matching rows",
        "5. Only when the user wants the content, call `iris_message_body`",
        "6. Optionally call `iris_message_diagram`",
        "7. Report the messages found",
      ]);
    }
  });

  it("find-patient-messages pins the block refusal, the 7-day window, the no-other-route rule and tighten-only dataPolicy", async () => {
    for (const { label, name, body } of await renderings()) {
      if (name !== "find-patient-messages") continue;
      expect(body, label).toContain('`action: "searchTable"`');
      expect(body, label).toContain("`DATA_POLICY_BLOCKED`");
      expect(body, label).toContain("Do not look the patient up another way");
      expect(body, label).toContain("at most 7 days");
      expect(body, label).toContain("never search without a window");
      expect(body, label).toContain("never read a withheld body another way");
      expect(body, label).toContain("can only tighten the profile's policy");
      expect(body, label).toContain("`dataPolicyClamped`");
      expect(body, label).toContain("`notApplicable`");
      expect(body, label).toContain("does not prove that no message holds the value");
    }
  });

  it("neither prompt tells the agent to loosen the policy or to read a withheld body another way", async () => {
    for (const { label, body } of await renderings()) {
      expect(body, label).not.toMatch(/dataPolicy"?\s*[:=]\s*"?allow/i);
      expect(body, label).not.toMatch(/set\s+`?dataPolicy`?\s+to\s+`?allow/i);
      expect(body, label).not.toMatch(/IRIS_DATA_POLICY/);
      expect(body, label).toContain("another way");
    }
  });

  it("every iris_* token of both prompts is an interop core tool or iris_server_profiles", async () => {
    const presets = (await import(
      pathToFileURL(resolve(root, "packages/iris-interop-mcp/dist/tools/presets.js")).href
    )) as { toolPresets: { core: { include: string[] } } };
    const allowed = new Set([...presets.toolPresets.core.include, "iris_server_profiles"]);
    expect(allowed.has("iris_message_body")).toBe(true);
    expect(allowed.has("iris_message_search")).toBe(true);

    for (const { label, body } of await renderings()) {
      const tokens = [...new Set(body.match(/\biris_[a-z_]+/g) ?? [])];
      expect(tokens.length, label).toBeGreaterThan(0);
      expect(
        tokens.filter((token) => !allowed.has(token)),
        label,
      ).toEqual([]);
    }
  });

  it("carries no internal rule number and no repository path", async () => {
    for (const { label, body } of await renderings()) {
      expect(body, label).not.toMatch(/Rule #\d/);
      expect(body, label).not.toMatch(/iris-execute-mcp-v2|packages\/|_bmad|\.claude|node_modules|research\/|deferred-work|spec-\d/);
    }
  });
});

describe("deploy-and-test-class - the optional coverage step and the PRODUCTION_BUSY note (Story 40.4)", () => {
  /** Both renderings of the prompt: with its argument, and the skill form. */
  async function deployRenderings(): Promise<Array<{ label: string; body: string }>> {
    const { prompt } = await findPrompt("deploy-and-test-class");
    return [
      { label: "deploy-and-test-class", body: prompt.build({ classOrPackage: "MyApp.MyClass" }) },
      { label: "deploy-and-test-class (skill form)", body: prompt.build({}) },
    ];
  }

  /** The text of step `n` of a rendering: from its number to the next step's. */
  function stepText(body: string, n: number): string {
    const from = body.indexOf(`\n${n}. `);
    const to = body.indexOf(`\n${n + 1}. `);
    expect(from, `step ${n} exists`).toBeGreaterThan(-1);
    return body.slice(from, to === -1 ? undefined : to);
  }

  it("keeps its name, title and one required argument, and its description gains the coverage clause", async () => {
    const { pkg, prompt } = await findPrompt("deploy-and-test-class");
    expect(pkg).toBe("iris-dev-mcp");
    expect(prompt.title).toBe("Deploy And Test Class");
    expect((prompt as unknown as { arguments: Array<{ name: string; required: boolean }> }).arguments.map((a) => [a.name, a.required])).toEqual([
      ["classOrPackage", true],
    ]);
    expect(prompt.description).toBe(
      "Deploy an ObjectScript class or package to IRIS (iris_doc_load, glob-path form), fix compile errors, then run its unit tests " +
        "(iris_execute_tests) with a total-count check and, when asked, measure their line coverage (iris_test_coverage).",
    );
  });

  it("step 4 tells the model what a PRODUCTION_BUSY refusal means, to tell the user, and not to stop that production without confirmation", async () => {
    for (const { label, body } of await deployRenderings()) {
      const step = stepText(body, 4);
      expect(step, label).toContain("If the response is a `PRODUCTION_BUSY` refusal, nothing ran");
      expect(step, label).toContain("a production other than the tests' own is running in the namespace, and the refusal names it");
      expect(step, label).toContain("Tell the user, and do not stop that production unless the user confirms it is a leftover of an interrupted test run.");
    }
  });

  it("step 8 is the optional coverage step, only on the user's request and once the tests pass, and step 9 reports", async () => {
    for (const { label, body } of await deployRenderings()) {
      const at = ["\n7. ", "\n8. Optional", "\n9. Report"].map((marker) => body.indexOf(marker));
      expect(at.every((index) => index > -1), label).toBe(true);
      expect([...at].sort((a, b) => a - b), label).toEqual(at);
      const step = stepText(body, 8);
      expect(step, label).toContain("only when the user asks how much of the code the tests cover or gives a coverage target, and once the tests pass");
      expect(step, label).toContain("call `iris_test_coverage` with the same `target` and `level`");
      expect(step, label).toContain("(not the test classes; at most 50)");
      expect(step, label).toContain("`minCoverage` set to the user's target when there is one");
      expect(stepText(body, 9), label).toContain("and the coverage, when it was measured");
    }
  });

  it("step 8 copes with a hidden tool and with a GOVERNANCE_DISABLED, MONITOR_BUSY and PRODUCTION_BUSY refusal, and never works around one", async () => {
    for (const { label, body } of await deployRenderings()) {
      const step = stepText(body, 8);
      expect(step, label).toContain("If `iris_test_coverage` is not in your tool list, the tool-visibility preset hides it (it is outside `core`)");
      expect(step, label).toContain("`IRIS_TOOLS_PRESET`");
      expect(step, label).toContain("If it is refused with `GOVERNANCE_DISABLED`, it is disabled by default because it starts an instance-wide monitor and runs test code");
      expect(step, label).toContain('`{"global":{"iris_test_coverage":true}}`');
      expect(step, label).toContain("do not measure coverage another way");
      expect(step, label).toContain("If it is refused with `MONITOR_BUSY`, another monitor session is running on the instance (its `owner` says whose) and nothing was started");
      expect(step, label).toContain("never stop that session");
      expect(step, label).toContain("If it is refused with `PRODUCTION_BUSY`, handle it as in step 4.");
      expect(body, label).not.toContain("iris_production_control");
    }
  });

  it("step 8 polls a running coverage run by its coverageRunId and never re-submits, reports a failing verdict as a result, and exports only to a path the user chose", async () => {
    for (const { label, body } of await deployRenderings()) {
      const step = stepText(body, 8);
      expect(step, label).toContain('If the response has `status: "running"`, do NOT re-submit');
      expect(step, label).toContain('call `iris_test_status` with `action: "poll"` and the response\'s `coverageRunId` until it completes');
      expect(step, label).toContain("(a failing verdict is a result, not a tool error)");
      expect(step, label).toContain('`action: "export"`, the `coverageRunId` and an absolute `outputPath` ending in `.xml` that the user chose');
      expect(step, label).toContain("export is disabled by default too (`iris_test_status:export`), so handle a `GOVERNANCE_DISABLED` refusal the same way.");
    }
  });

  it("every other step is the 38.6 text: step 2 keeps its number and its in-place fix route", async () => {
    for (const { label, body } of await deployRenderings()) {
      expect(stepText(body, 2), label).toContain("A class that has no local source file (it exists only in IRIS) is fixed in place instead");
      expect(stepText(body, 6), label).toContain("**compare the returned `total` against the expected number of test methods**");
      expect(stepText(body, 7), label).toContain("rerun `iris_execute_tests`");
    }
  });
});
