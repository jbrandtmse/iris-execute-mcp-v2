/**
 * Story 24.0 QA — safety-relevant regression pins for
 * `BASELINE_ACTION_CLASSIFICATIONS`.
 *
 * `baseline-classifications.test.ts` (dev-authored) proves the map's
 * STRUCTURAL contract: exact key-set parity with the frozen
 * {@link GOVERNANCE_BASELINE} (no missing/extra keys) and that every value is
 * literally `"read"` or `"write"`. It does NOT pin any individual key's
 * VALUE — a well-intentioned future edit could flip a genuine write (e.g.
 * `iris_execute_command`) to `"read"` and every existing assertion would
 * still pass, because completeness/shape checks are blind to which side of
 * read/write a specific key landed on.
 *
 * This file complements that suite (does not duplicate it) with
 * VALUE-level regression pins for the keys where a misclassification would
 * be a genuine safety-guarantee breach once Story 24.1's `read-only` preset
 * consumes this map: a `write` action wrongly marked `read` would execute
 * under `IRIS_GOVERNANCE_PRESET=read-only` (AC 24.0.2's own "false read is a
 * safety-guarantee breach" framing).
 *
 * Two kinds of pin:
 *   1. Named spot-checks on well-known execution/mutation keys (must stay
 *      `write`) and well-known pure-query keys (must stay `read`), including
 *      the three documented judgment calls (`iris_doc_export`,
 *      `iris_execute_tests`, `iris_sql_execute`) that deliberately diverge
 *      from their own tool's `annotations.readOnlyHint` per the dev's
 *      fail-safe reasoning (Dev Notes, Completion Notes List) — exactly the
 *      kind of "looks read-ish" key a future edit is most likely to flip.
 *   2. A systematic verb-suffix sweep: every `tool:action` key in the map
 *      whose action verb is an unambiguous write verb (create/delete/modify/
 *      set/update/build/sync/reset/add/remove/enable/disable, per AC
 *      24.0.2's own verb lists) must classify `write`; every key whose verb
 *      is an unambiguous read verb (list/get) must classify `read`. This
 *      derives the KEY SET from the live map at runtime (never hand-copied)
 *      and only hardcodes the verb vocabulary, which is a stable convention
 *      from the AC text, not part of the governed surface that can drift.
 *
 * Discoverable by the default `vitest run` suite (`*.test.ts`, NOT
 * `*.integration.test.ts` — Rule #21). No live IRIS required.
 */

import { describe, it, expect } from "vitest";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";

describe("BASELINE_ACTION_CLASSIFICATIONS safety-relevant value pins (QA)", () => {
  // ── 1a. Well-known execution/mutation keys must stay "write" ──────────
  it.each([
    "iris_execute_command",
    "iris_execute_classmethod",
    "iris_global_set",
    "iris_global_kill",
    "iris_doc_put",
    "iris_doc_load",
    "iris_doc_compile",
    "iris_database_manage:create",
    "iris_database_manage:delete",
    "iris_database_manage:modify",
    "iris_user_manage:create",
    "iris_role_manage:delete",
    "iris_resource_manage:modify",
    "iris_namespace_manage:create",
    "iris_task_run",
  ])('"%s" classifies as "write"', (key) => {
    expect(BASELINE_ACTION_CLASSIFICATIONS[key]).toBe("write");
  });

  // ── 1b. Well-known pure-query keys must stay "read" ────────────────────
  it.each([
    "iris_database_list",
    "iris_config_manage:get",
    "iris_permission_check",
    "iris_database_check",
    "iris_journal_info",
    "iris_license_info",
    "iris_mirror_status",
    "iris_locks_list",
    "iris_jobs_list",
    "iris_production_status",
    "iris_production_summary",
    "iris_role_list",
    "iris_user_get",
  ])('"%s" classifies as "read"', (key) => {
    expect(BASELINE_ACTION_CLASSIFICATIONS[key]).toBe("read");
  });

  // ── 1c. Documented judgment calls (diverge from the tool's own
  //        annotations.readOnlyHint per the dev's fail-safe reasoning) —
  //        the exact keys a future "helpful" sync-to-annotations edit would
  //        most plausibly flip. Pinned individually with the rationale.
  it('"iris_doc_export" stays "write" despite bulk-downloading (no IRIS-state mutation, but a caller-controlled local-disk write surface — fail-safe per AC 24.0.2)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_doc_export"]).toBe("write");
  });

  it('"iris_execute_tests" stays "write" despite annotations.readOnlyHint:true (runs real ObjectScript unit-test methods; setup/teardown can mutate state)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_execute_tests"]).toBe("write");
  });

  it('"iris_sql_execute" stays "write" (SELECT-only is not guaranteed — arbitrary DML/DDL is possible; AC 24.0.2 explicitly flags this key)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_sql_execute"]).toBe("write");
  });

  it('"iris_oauth_manage:discover" stays "write" (Discover() PERSISTS — deletes+refreshes the issuer\'s OAuth2 server metadata inside a committed transaction; irislib/%SYS/OAuth2/Registration.cls)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_oauth_manage:discover"]).toBe(
      "write",
    );
  });

  it('"iris_transform_test" stays "write" (executes a caller-named compiled DTL Transform() method — arbitrary code, tool\'s own readOnlyHint:false; fail-safe over AC 24.0.2\'s "dry-run" example)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_transform_test"]).toBe("write");
  });

  it('"iris_user_password:validate" stays "read" (ValidatePassword() checks policy only — never persists/changes the candidate password)', () => {
    expect(BASELINE_ACTION_CLASSIFICATIONS["iris_user_password:validate"]).toBe(
      "read",
    );
  });

  // ── 2. Systematic verb-suffix sweep over the LIVE map ──────────────────
  //
  // Key set is derived at runtime from BASELINE_ACTION_CLASSIFICATIONS
  // itself (never hand-copied); only the verb vocabulary is hardcoded, and
  // it is drawn directly from AC 24.0.2's own write/read verb lists.
  const WRITE_VERBS = new Set([
    "create",
    "delete",
    "modify",
    "set",
    "update",
    "build",
    "sync",
    "reset",
    "add",
    "remove",
    "enable",
    "disable",
    // Additional unambiguous write verbs that occur as `tool:action` keys in
    // the frozen baseline (CR 24.0 — the original sweep silently skipped these,
    // leaving those write keys unpinned against a future read-flip):
    "drop", // iris_docdb_manage:drop, iris_docdb_property:drop
    "insert", // iris_docdb_document:insert
    "import", // iris_doc_xml_export:import, iris_lookup_transfer:import
    "index", // iris_docdb_property:index
    "recover", // iris_production_control:recover
    "restart", // iris_production_control:restart
    "start", // iris_production_control:start
    "stop", // iris_production_control:stop
  ]);
  const READ_VERBS = new Set(["list", "get"]); // the only read-allowlist verbs
  // that actually occur as `tool:action` keys in the frozen baseline (the
  // rest of the AC 24.0.2 read allowlist — status/check/history/explain/
  // stats/summary/info/find/search/adapters/queues/messages/logs — only
  // occurs as BARE tool names in this baseline, not as an action suffix).

  function actionKeysByVerb(verbs: Set<string>): Array<[string, string]> {
    return Object.entries(BASELINE_ACTION_CLASSIFICATIONS)
      .filter(([key]) => key.includes(":"))
      .map(([key, value]) => [key, value] as [string, string])
      .filter(([key]) => {
        const verb = key.split(":")[1];
        return verb !== undefined && verbs.has(verb);
      });
  }

  it("every unambiguous write-verb action key (create/delete/modify/set/update/build/sync/reset/add/remove/enable/disable) classifies \"write\"", () => {
    const matches = actionKeysByVerb(WRITE_VERBS);
    // Tripwire: fail loudly if the baseline's shape changes such that none of
    // these verbs occur anymore (would make this sweep vacuous).
    expect(matches.length).toBeGreaterThan(30);
    const misclassified = matches
      .filter(([, value]) => value !== "write")
      .map(([key, value]) => `${key}=${value}`);
    expect(misclassified).toEqual([]);
  });

  it('every unambiguous read-verb action key (list/get) classifies "read"', () => {
    const matches = actionKeysByVerb(READ_VERBS);
    expect(matches.length).toBeGreaterThan(5);
    const misclassified = matches
      .filter(([, value]) => value !== "read")
      .map(([key, value]) => `${key}=${value}`);
    expect(misclassified).toEqual([]);
  });
});
