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
import { fileURLToPath } from "node:url";
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
  it("instructs a glob-prefixed path, warning that a bare path mis-maps the class name", async () => {
    const { pkg, prompt } = await findPrompt("deploy-and-test-class");
    expect(pkg).toBe("iris-dev-mcp");
    const body = prompt.build({ classOrPackage: "MyApp.MyClass" });

    expect(body.toLowerCase()).toContain("glob-prefixed path");
    expect(body.toLowerCase()).toContain("mis-maps the class name");
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
