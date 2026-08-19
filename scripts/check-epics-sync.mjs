#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// check-epics-sync.mjs (Story 35.8, AC 35.8.3 — Rules #51/#55/#56)
//
// Mechanical cross-check that sprint-status.yaml's story keys and epics.md's
// "### Story N.M:" sections correspond, in BOTH directions, with CLASSIFICATION
// rather than a flat flag:
//
//   keys → sections:  every story key in sprint-status.yaml (development_status
//                     entries matching ^\d+-\d+-) must have a `### Story N.M:`
//                     section in epics.md — UNLESS the key is EXPECTED-ABSENT:
//                     runtime-created gate/cleanup stories that were never part
//                     of the planning document BY DESIGN:
//                       - /^\d+-0-epic-\d+-deferred-cleanup$/  (epic-cycle's
//                         retro-review gate creates "Story N.0: Epic N-1
//                         Deferred Cleanup" at runtime when the prior epic's
//                         ledger is non-empty)
//                       - /-cleanup$/  (e.g. 33-5-late-findings-cleanup —
//                         review-close cleanup stories created at runtime)
//                     Any OTHER key without a section is GENUINE DRIFT → exit 1.
//
//   sections → keys:  every `### Story N.M:` section must map to a story key
//                     `N-M-*` in sprint-status.yaml. An unmapped section is an
//                     ORPHAN (a section for a story the sprint never ran) →
//                     exit 1.
//
// The check NEVER edits either file. Exit 0 = no genuine drift (expected-absent
// and zero orphans is a clean run). Run after any epic close or correct-course
// that adds stories at runtime, so the 15-row false-positive class this script
// was built to classify never needs re-triaging by hand.
//
// Baseline at introduction (2026-08-19, post-34.5-backfill): 186 keys, 171
// sections, 15 expected-absent, 0 orphans, 0 genuine drift. Counts move as
// epics land — the SCRIPT is the contract, not these numbers.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPRINT = resolve(root, "_bmad-output/implementation-artifacts/sprint-status.yaml");
const EPICS = resolve(root, "_bmad-output/planning-artifacts/epics.md");

const EXPECTED_ABSENT = [
  /^\d+-0-epic-\d+-deferred-cleanup$/,
  /-cleanup$/,
];

const sprint = readFileSync(SPRINT, "utf8");
const epics = readFileSync(EPICS, "utf8");

// Story keys: `  N-M-slug: status` lines (epic keys `epic-N` and
// `epic-N-retrospective` do not match the \d+-\d+- shape and are excluded).
const storyKeys = [];
for (const line of sprint.split("\n")) {
  const m = line.match(/^\s{2}(\d+-\d+-[a-z0-9-]+):\s*\S+/);
  if (m) storyKeys.push(m[1]);
}

// Sections: `### Story N.M:` headers (list items like `- 34.5 ...` do NOT match).
const sections = [];
for (const line of epics.split("\n")) {
  const m = line.match(/^### Story (\d+)\.(\d+):/);
  if (m) sections.push(`${m[1]}.${m[2]}`);
}

const sectionSet = new Set(sections);
const keyPrefixSet = new Set(storyKeys.map((k) => {
  const m = k.match(/^(\d+)-(\d+)-/);
  return `${m[1]}.${m[2]}`;
}));

const absentExpected = [];
const absentGenuine = [];
for (const key of storyKeys) {
  const m = key.match(/^(\d+)-(\d+)-/);
  const nm = `${m[1]}.${m[2]}`;
  if (sectionSet.has(nm)) continue;
  (EXPECTED_ABSENT.some((re) => re.test(key)) ? absentExpected : absentGenuine).push(key);
}

const orphans = sections.filter((nm) => !keyPrefixSet.has(nm));

// Duplicate sections (35.8 review, Blind B3): a Set-based correspondence check
// is blind to a `### Story N.M:` header appearing TWICE — an authoring error
// that correspondence alone cannot see. Flag each duplicated section.
const seenSections = new Set();
const duplicateSections = [];
for (const s of sections) {
  if (seenSections.has(s)) duplicateSections.push(s);
  seenSections.add(s);
}

console.log(`sprint-status.yaml story keys : ${storyKeys.length}`);
console.log(`epics.md '### Story N.M:' sections : ${sections.length}`);
console.log(`keys without a section — EXPECTED (runtime-created cleanup/gate): ${absentExpected.length}`);
for (const k of absentExpected) console.log(`  expected-absent: ${k}`);
console.log(`keys without a section — GENUINE DRIFT: ${absentGenuine.length}`);
for (const k of absentGenuine) console.log(`  GENUINE DRIFT: ${k}`);
console.log(`sections without a key — ORPHANS: ${orphans.length}`);
for (const s of orphans) console.log(`  ORPHAN: ${s}`);
console.log(`sections appearing more than once — DUPLICATES: ${duplicateSections.length}`);
for (const s of duplicateSections) console.log(`  DUPLICATE: ${s}`);

if (absentGenuine.length > 0 || orphans.length > 0 || duplicateSections.length > 0) {
  console.error(
    "\nFAIL: genuine drift detected. Add the missing section(s) to epics.md " +
      "(reconstructed from the story file, never invented), remove the orphan " +
      "or duplicated section(s), or — only for a runtime-created cleanup/gate story — confirm " +
      "the key matches the EXPECTED_ABSENT convention documented in this script's header.",
  );
  process.exit(1);
}
console.log("\nOK: no genuine drift (all absences are the documented expected class; no orphans).");
