/**
 * Story 45.5 QA (Rules #19, #36, #54, #56, #59) - the sentences of the README section "What the safety settings protect" that
 * `story-45-5-doc-claims.test.ts` and `epic45-capstone-gate.test.ts` leave without an oracle. The existing tests pin the section's
 * sentences against the built dists and the embed; this file closes these gaps:
 *
 *  1. DW-766 / Probe A: the sentence that the server's own check of the IRIS side needs `R` on the routines database; the symptoms (500
 *     and 403) and the read-only account against the ROWS of the recorded probe table (LP1, LP4, LP10, LP11), not only against the
 *     heading of the probe; the code oracle for "the server's own check" (the built bootstrap reads `Setup_GetBootstrapVersion`
 *     through Atelier `action/query`).
 *  2. DW-771: point 3 against the spec's amendment A2 (the README residual bullet names every backticked identifier A2 names), against
 *     Probe B's recorded results, and against `Configure`'s namespace parameter in the embed; points 1 and 2 against the recorded
 *     decision-#165 fact. The README must NOT say that `EXECUTE` protects the setup procedures: every sentence that names `EXECUTE`
 *     is one of the three allowed ones, and the refusal at prepare is followed by the sentence that says Atelier skips the check.
 *  3. AD-7 / Rule #56: tool visibility (`IRIS_TOOLS_*`) is not in the guard list and is never called a safety control; `IRIS_AUTO_INSTALL`
 *     is not in the guard list; and the variable-table classification is checked against the variables the PRODUCT CODE reads, not only
 *     against the README table (a variable the README table omits cannot be classified by a test that walks the table).
 *  4. DW-773: the install-ON half of the least-privilege paragraph, behaviorally, on the built dev server against the stateful fake with
 *     `Setup_Configure` refused (`<PROTECT>`): every start recompiles the classes, the warning says `registration requires
 *     %Admin_Manage privileges`, and the tools run. (The install-off half is pinned for all three channels by
 *     `story-45-2-auto-install-orchestration.test.ts` and by the capstone's LP-hermetic leg.) Also the
 *     sentence "after an upgrade of the servers, repeat the install once" and the shipped-behavior-only wording.
 *  5. The anchors: every in-page link of the section resolves to a README heading, the `SECURITY.md` link resolves to a file, and the
 *     "Installs nothing on IRIS" and "SQL write safety" texts the section points to exist.
 *  6. The startup warning's pointer, in all THREE variants (redact-only, block-only, mixed), from the built dist: each ends with the new
 *     pointer, quotes it exactly once, and the quoted title is a `## ` heading of the README.
 *
 * Needs no IRIS and no docker. Reads the built shared and dev dists and FAILS (never skips) when they are stale or missing.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, markdownHeadingSlugs } from "./pack-fixture";
import { resolveSdkEsmDir, staleDistReason, type IrisTarget } from "./process-gate-helpers";
import { customRestIn, loadEmbedded, runServerCalls, seedInstance, type EmbeddedBootstrap } from "./bootstrap-guard-legs";
import { startStatefulFakeAtelier, type StatefulFakeAtelier } from "./stateful-fake-atelier";
import {
  README,
  SECTION_SLUG,
  SECTION_TITLE,
  backtickTokens,
  loadSharedDist,
  paragraphStarting,
  readRepo,
  sectionOf,
  squash,
  variableTableNames,
} from "./story-45-5-section";

const section = sectionOf();
const sec = squash(section);
const SPEC = "_bmad-output/implementation-artifacts/spec-45-5-what-the-safety-settings-protect.md";
const spec = readRepo(SPEC);

/** The sentences of a squashed text: a sentence ends at `. ` (or the end) before a capital letter, a backtick, an asterisk or a dash. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+(?=[A-Z`*\-\[])/).map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");

/** The line of the spec whose trimmed text starts with `prefix` ("" when there is none). */
const specLine = (prefix: string): string => squash(spec.split("\n").find((line) => line.trim().startsWith(prefix)) ?? "");

// Every group below reads the built shared dist, so a stale or missing one fails the file before any group runs.
beforeAll(() => {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale !== undefined) {
    throw new Error(`The Story 45.5 QA doc oracles read the built shared dist and need no IRIS, so a stale or missing dist fails them instead of skipping them: ${stale}`);
  }
});

// -- 1. DW-766, Probe A ----------------------------------------------------------------------------

describe("Story 45.5 QA: DW-766 against Probe A's recorded rows", () => {
  it("the server's own check of the IRIS side needs R on the routines database, on a split layout: the sentence, Probe A's record and the code", () => {
    expect(sec).toContain("The server's own check of the IRIS side needs the same `R` on the routines database. This was read on IRIS 2026.2, on a namespace with separate globals and routines databases.");
    expect(squash(spec)).toContain("Atelier `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` (the bootstrap's read) needs the same `R` on SPLITR.");
    expect(squash(spec)).toContain("on IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U)");
    // The built bootstrap's own check is that read, through Atelier `action/query`.
    const bootstrap = readFileSync(path.join(REPO_ROOT, "packages", "shared", "dist", "bootstrap.js"), "utf8");
    expect(bootstrap).toContain("SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()");
    expect(bootstrap).toContain("action/query");
  });

  it("the symptoms: without R on the routines database HTTP 500 (<PROTECT>); without R on the globals database HTTP 403 (rows LP1 and LP4)", () => {
    const lp1 = specLine("| LP1 |");
    const lp4 = specLine("| LP4 |");
    expect(lp1, "Probe A's LP1 row exists").not.toBe("");
    expect(lp1).toContain("| SPLIT | HTTP 500 `<PROTECT>");
    expect(lp1, "LP1 holds the globals database only").toContain("`%DB_SPLITG:RW`");
    expect(lp4, "Probe A's LP4 row exists").not.toBe("");
    expect(lp4).toContain("| `SPLITR:R` | SPLIT | HTTP 403 |");
    expect(sec).toContain("Without `R` on it, the route answers HTTP 500 with `<PROTECT>`.");
    expect(sec).toContain("Without `R` on it, the route answers HTTP 403.");
    // The finding of the probe states the same two causes in the same order.
    const finding = squash(spec.slice(spec.indexOf("- **Finding:** the minimum account is"), spec.indexOf("- Teardown:", spec.indexOf("- **Finding:** the minimum account is"))));
    expect(finding.indexOf("Without it: HTTP 500 `<PROTECT>`.")).toBeGreaterThan(-1);
    expect(finding.indexOf("Without it: HTTP 403.")).toBeGreaterThan(finding.indexOf("Without it: HTTP 500 `<PROTECT>`."));
    expect(finding).toContain("Write access to the routines database is not needed");
  });

  it("the read-only account: R on the routines and globals databases reads and cannot write, on a split and a mapped layout (rows LP10 and LP11)", () => {
    for (const row of ["| LP10 |", "| LP11 |"]) {
      const line = specLine(row);
      expect(line, `Probe A's ${row} row exists`).not.toBe("");
      expect(line).toContain("200 with `readOnly:true` and without");
      expect(line).toContain("INSERT answers -99");
      expect(line).not.toContain("RW`");
    }
    expect(sec).toContain("a separate read-only account that holds `R`, never `RW`, on its database resources. It still needs `%Development:U`, because the web application requires it.");
  });

  it("what a %Development account can do (the code reach) is stated with its limit: the database resources bound the data", () => {
    expect(sec).toContain("With it, an account runs ObjectScript through the command tools and compiles code through Atelier, and that code reads globals subject to the database resources.");
    // The two tools the sentence names exist as covered keys of the data policy's `block` declaration (iris_execute_command) and as a dev tool.
    expect(sec).toContain("`iris_execute_command`");
    const dev = readRepo("tool_support.md");
    expect(dev).toContain("`iris_execute_command`");
    expect(dev).toContain("`iris_doc_compile`");
  });
});

// -- 2. DW-771 -------------------------------------------------------------------------------------

describe("Story 45.5 QA: DW-771 points 1 to 4 against A2, Probe B and decision #165", () => {
  const residual = paragraphStarting(section.slice(section.indexOf("- The residual.")), "- The residual.");

  it("point 3 names every identifier amendment A2 names (A2 is the binding text; the README may not drop one)", () => {
    const a2 = specLine("- **A2 (the DW-771 bullet, point 3).**");
    expect(a2, "the spec holds amendment A2").not.toBe("");
    const replacement = a2.slice(a2.indexOf(" with: ") + " with: ".length);
    expect(replacement.length, "A2's replacement text was found").toBeGreaterThan(300);
    const wanted = [...new Set(backtickTokens(replacement))];
    for (const token of ["iris_sql_query", "Configure", "ConfigureMapping", "SELECT", "%ALL", "ExecuteMCPv2", "iris.cpf", "Config.Namespaces", "Config.MapPackages", "action/query"]) {
      expect(wanted, `A2 names ${token}`).toContain(token);
    }
    expect(residual, "the README's residual bullet was found").toContain("The residual.");
    const have = new Set(backtickTokens(residual));
    expect(wanted.filter((token) => !have.has(token)), "identifiers of A2 the README's residual bullet lacks").toEqual([]);
  });

  it("point 3 against Probe B's recorded results: Configure is rolled back through the route and moves the web application through Atelier; ConfigureMapping is not undone", () => {
    const probe = squash(spec.slice(spec.indexOf("**Probe B: DW-771 point 3 (Rule #42).**"), spec.indexOf("**Section content")));
    // Rolled back through the route (the README's "undoes the change Configure makes to the web application").
    expect(probe).toContain("the web application's namespace stayed `HSCUSTOM` (rolled back)");
    // Not rolled back through Atelier action/query (the README's "can point the web application at another namespace").
    expect(probe).toContain("the same statement moved the web application to `USER`");
    // ConfigureMapping is not undone: the records say absent, the effect is real (the README's "iris.cpf and the running configuration").
    expect(probe).toContain("`Config.MapPackages.Exists` = 0");
    expect(probe).toContain("USER sees `ExecuteMCPv2.Setup` again");
    expect(probe).toContain("`iris.cpf` holds `Package_ExecuteMCPv2=HSCUSTOM`");
    expect(probe).toContain("`Config.Namespaces.Exists(\"%ALL\")` = 0");
    expect(probe).toContain("`iris.cpf` has `%ALL=%DEFAULTDB` and the mapping back");
    // Story 45.6 (DW-786): the residual now says the route's rollback was what left `ConfigureMapping`'s effect behind, and that the guard refuses the call.
    expect(residual).toContain("Before `1.3.0`, `iris_sql_query` rolled the statement back, which undid the change `Configure` makes to the web application but not the effect of `ConfigureMapping`");
    expect(residual).toContain("From `1.3.0` both methods refuse that call and change nothing");
  });

  it("the code can do what the residual says: Configure takes a namespace argument and sets the web application's namespace from it", async () => {
    const { BOOTSTRAP_CLASSES } = await loadSharedDist<{ BOOTSTRAP_CLASSES: Map<string, string> }>("bootstrap-classes.js");
    const setup = BOOTSTRAP_CLASSES.get("ExecuteMCPv2.Setup.cls") ?? "";
    const configure = setup.slice(setup.indexOf("ClassMethod Configure("), setup.indexOf("ClassMethod ConfigureMapping("));
    expect(configure).toContain('ClassMethod Configure(pNamespace As %String = "")');
    expect(configure).toMatch(/Set tProps\("NameSpace"\) = pNamespace/);
  });

  it("points 1 and 2 against the recorded decision-#165 facts, and the README does not say EXECUTE protects the setup procedures", () => {
    const facts = squash(spec);
    expect(facts).toContain("Through `iris_sql_query`, an account without `EXECUTE` is refused on all five `Setup` procedures.");
    expect(facts).toContain("Through Atelier `action/query`, the same account calls them with no `EXECUTE` check, and `Configure` and `ConfigureMapping` fail with `<PROTECT>` (decision #165).");
    expect(facts).toContain("A least-privilege account is refused on all five procedures through the suite (decision #165).");

    // Every sentence of the section that names EXECUTE is one of the three allowed ones: a SELECT of a SqlProc needs it through the suite;
    // Atelier skips the check; through `iris_sql_query` an account without it is refused at prepare (the cause decision #165 recorded).
    // Any other claim, such as "an EXECUTE grant protects the procedures", is not allowed.
    const allowed = [
      "Through the suite, that call needs `EXECUTE` on the method.",
      "SQL can call all five, Atelier's `action/query` included, and Atelier skips the `EXECUTE` check.",
      "Through `iris_sql_query`, an account without the `EXECUTE` privilege on them is refused when the statement is prepared, with `SQLCODE -99`, and nothing runs.",
    ];
    const naming = sentencesOf(sec).filter((sentence) => /\bEXECUTE\b/.test(sentence));
    expect(naming.length, "the section names EXECUTE at all").toBeGreaterThan(0);
    for (const sentence of naming) {
      expect(
        allowed.some((one) => sentence.includes(one) || one.includes(sentence)),
        `an EXECUTE sentence that is not one of the allowed two: ${sentence}`,
      ).toBe(true);
    }
    // The setup-procedures paragraph holds the Atelier sentence only, and its boundary is the account's privileges.
    const procedures = paragraphStarting(section, "**The five setup procedures.**");
    expect(procedures).not.toMatch(/\bEXECUTE\b/);
    const bullets = squash(section.slice(section.indexOf("**The five setup procedures.**"), section.indexOf("**What the data policy covers.**")));
    expect(bullets.match(/\bEXECUTE\b/g)?.length, "the five-procedures block names EXECUTE twice: the Atelier-skips and the refused-at-prepare sentences").toBe(2);
    expect(bullets).not.toMatch(/EXECUTE[^.]*\b(?:protect|guard|stop|prevent|secure)/i);
    // The refusal at prepare is never left standing alone as a protection: the next sentence says Atelier skips that check.
    const prepare = bullets.indexOf("is refused when the statement is prepared, with `SQLCODE -99`");
    expect(prepare, "the prepare-time refusal sentence").toBeGreaterThan(-1);
    expect(bullets.slice(prepare)).toMatch(/^[^.]*\.\s*Through Atelier, which skips that check,/);
  });
});

// -- 3. AD-7 and Rule #56 --------------------------------------------------------------------------

describe("Story 45.5 QA: tool visibility is not a safety control, and the variable classification is complete against the code (AD-7, Rule #56)", () => {
  it("IRIS_TOOLS_* and IRIS_AUTO_INSTALL are not in the guard list, and no sentence calls IRIS_TOOLS_* a safety control", () => {
    const guards = squash(section.slice(section.indexOf("**The settings guard the agent.**"), section.indexOf("Anyone who holds the same account")));
    expect(guards).toContain("`IRIS_GOVERNANCE`");
    expect(guards, "visibility is not in the guard list").not.toMatch(/IRIS_TOOLS_/);
    expect(guards, "the install setting is not in the guard list").not.toContain("IRIS_AUTO_INSTALL");
    for (const sentence of sentencesOf(sec).filter((one) => /IRIS_TOOLS_/.test(one))) {
      expect(sentence, "a sentence naming IRIS_TOOLS_* says it only changes what the agent is shown").toContain("only changes what the agent is shown");
      expect(sentence).not.toMatch(/\b(?:is|are) (?:a|the|one of the) (?:safety|security) (?:control|setting)/i);
    }
    // SECURITY.md's list of controls does not hold visibility either.
    expect(readRepo("SECURITY.md")).not.toMatch(/IRIS_TOOLS_|tool visibility/i);
  });

  it("every variable the product code reads is a row of the README table or a named known gap (the table is the thing Rule #56 classifies)", () => {
    // A variable the code reads that is deliberately not a README row goes here, with its reason. None is today.
    const KNOWN_GAP: Record<string, string> = {};
    const read = new Set<string>();
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!["__tests__", "test-helpers", "node_modules", "dist"].includes(entry.name)) walk(full);
        } else if (/\.ts$/.test(entry.name) && entry.name !== "bootstrap-classes.ts") {
          for (const match of readFileSync(full, "utf8").matchAll(/\benv(?:\.|\["|\[')((?:IRIS|MCP)_[A-Z0-9_]+)/g)) read.add(match[1] as string);
        }
      }
    };
    const packages = path.join(REPO_ROOT, "packages");
    for (const name of readdirSync(packages)) {
      const src = path.join(packages, name, "src");
      if (existsSync(src)) walk(src);
    }
    expect(read.size, "the scan finds the variables at all").toBeGreaterThan(25);
    for (const name of ["IRIS_GOVERNANCE", "IRIS_DATA_POLICY", "IRIS_AUTO_INSTALL", "IRIS_SQL_READ_ONLY", "IRIS_TOOLS_PRESET", "MCP_TRANSPORT"]) {
      expect(read.has(name), `${name} is read by the code`).toBe(true);
    }
    const table = new Set(variableTableNames(README));
    expect([...read].filter((name) => !table.has(name) && KNOWN_GAP[name] === undefined), "variables the code reads that the README table omits").toEqual([]);
    for (const name of Object.keys(KNOWN_GAP)) {
      expect(read.has(name), `${name} is still read by the code`).toBe(true);
      expect(table.has(name), `${name} is still missing from the table (remove it from the known gaps once it is a row)`).toBe(false);
    }
  });

  it("the IRIS_TIMEOUT row states the default, the unit and the startup failure that config.ts implements", () => {
    const row = README.split("\n").find((line) => line.startsWith("| `IRIS_TIMEOUT` |")) ?? "";
    expect(row, "the row exists").not.toBe("");
    expect(row).toContain("| `60000` |");
    expect(row).toContain("**milliseconds**");
    expect(row).toContain("A value that is not a positive number fails startup naming the variable.");
    const config = readRepo("packages/shared/src/config.ts");
    expect(config).toContain("const timeout = rawTimeout !== undefined ? Number(rawTimeout) : 60_000;");
    expect(config).toContain("IRIS_TIMEOUT must be a positive number of milliseconds.");
    expect(readRepo("packages/shared/src/profiles.ts")).toContain("// timeout (inherited from default unless explicitly overridden)");
  });
});

// -- 4. DW-773, the install-on half ----------------------------------------------------------------

describe("Story 45.5 QA: DW-773, a least-privilege account with the automatic install ON, on the built dev server", () => {
  let embedded: EmbeddedBootstrap;
  let sdkEsmDir: string;
  const fakes: StatefulFakeAtelier[] = [];
  const NAMESPACE = "USER";
  const PASSWORD = "Pw-qa-45-5-never-logged";

  beforeAll(async () => {
    const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
    if (stale !== undefined) throw new Error(`The DW-773 install-on leg drives the built dev server and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
    const found = resolveSdkEsmDir(REPO_ROOT);
    if (found === undefined) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
    sdkEsmDir = found;
    embedded = await loadEmbedded(REPO_ROOT);
  });

  afterAll(async () => {
    await Promise.all(fakes.splice(0).map((fake) => fake.close()));
  });

  const targetOf = (fake: StatefulFakeAtelier): IrisTarget => ({ host: "127.0.0.1", port: String(fake.port), username: "fake", password: PASSWORD, namespace: NAMESPACE });
  const compilesIn = (window: ReadonlyArray<{ method: string; url: string }>): number =>
    window.filter((request) => request.method === "POST" && new URL(request.url, "http://fake.invalid").pathname.endsWith("/action/compile")).length;

  it(
    "install on (the default): every start recompiles the classes and warns that registration requires %Admin_Manage; the tools run (two starts)",
    async () => {
      const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
      fakes.push(fake);
      await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });
      // The account cannot read %SYS (IsConfigured answers false) and cannot register the web application (Configure is refused).
      fake.isConfiguredReadsFalse = true;
      fake.configureFails = true;
      for (const start of [1, 2]) {
        const before = fake.requests.length;
        const run = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: targetOf(fake) }, {}, [{ tool: "iris_global_get", args: { global: "QaEpic455" } }]);
        const window = fake.requests.slice(before);
        expect(compilesIn(window), `start ${start}: the classes are recompiled on every connect`).toBeGreaterThan(0);
        expect(window.some((request) => request.body.includes("Setup_Configure(")), `start ${start}: Configure was tried`).toBe(true);
        expect(squash(run.stderr), `start ${start}: the web application step warns`).toContain("registration requires %Admin_Manage privileges");
        expect(run.stderr, `start ${start}: this is not the install-off warning`).not.toContain("could not confirm that the /api/executemcp/v2 web application is registered");
        expect(run.stderr).not.toContain("IRIS_SIDE_NOT_INSTALLED");
        expect(customRestIn(window).length, `start ${start}: the tools run: the custom-REST call was sent`).toBeGreaterThan(0);
        expect(run.results[0], `start ${start}: the call was answered, not refused`).toBeDefined();
        expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
        expect(run.stderr).not.toContain(PASSWORD);
      }
    },
    120_000,
  );

  it("the README states exactly the two outcomes, only shipped behavior, and the one-time administrator install with the upgrade caveat", () => {
    const paragraph = squash(section.slice(section.indexOf("**A least-privilege account and the automatic install.**"), section.indexOf("\n---")));
    // Story 45.6 (DW-773): this outcome now belongs to a web application that is not registered; an installed side reads `current`.
    expect(paragraph).toContain("The web application is not registered, install on: every connect recompiles the classes, and the web application step fails with a warning that says `registration requires %Admin_Manage privileges`. The tools run.");
    expect(paragraph).toContain("After an upgrade of the servers, repeat the install once: see [Installs nothing on IRIS](#read-only-mode--point-it-at-production-with-one-environment-variable).");
    // Only the shipped behavior: no promise of a fix and no "will".
    expect(paragraph).not.toMatch(/\bwill (?:be|soon|later)\b|\bplanned\b|\bin a future\b|\bfixed in\b|\bDW-77\d\b/i);
    // The probe the sentences rest on is recorded (Rule #36).
    const facts = squash(spec);
    expect(facts).toContain("install off: one could-not-confirm warning on every start, and the tools run;");
    expect(facts).toContain("install on: every connect recompiles the classes and fails `Configure` with the `%Admin_Manage` warning, and the tools run.");
  });
});

// -- 5. The anchors --------------------------------------------------------------------------------

describe("Story 45.5 QA: every in-page link of the section resolves, and the texts it points to exist", () => {
  it("each `](#anchor)` of the section is a README heading slug, and the SECURITY.md link is a file", () => {
    const slugs = markdownHeadingSlugs(README);
    const anchors = [...section.matchAll(/\]\(#([^)\s]+)\)/g)].map((match) => match[1] as string);
    expect(anchors.length, "the section links to other parts of the README").toBeGreaterThanOrEqual(6);
    for (const anchor of anchors) expect(slugs.has(anchor), `the anchor #${anchor} is a README heading`).toBe(true);
    expect(sec).toContain("[SECURITY.md](SECURITY.md)");
    expect(existsSync(path.join(REPO_ROOT, "SECURITY.md"))).toBe(true);
  });

  it("the sections the pointers name carry the words the pointers use", () => {
    // `see *SQL write safety* under [Read-only mode]` and `see [Installs nothing on IRIS](...)`.
    const readOnlyAt = README.indexOf("\n### Read-only mode");
    expect(readOnlyAt, "the Read-only mode subsection exists").toBeGreaterThan(-1);
    const readOnly = README.slice(readOnlyAt, README.indexOf("\n### ", readOnlyAt + 5));
    expect(readOnly, "the Read-only mode section holds the SQL write safety text").toMatch(/SQL write safety/i);
    expect(readOnly, "and the bullet the install pointer names").toContain("Installs nothing on IRIS");
  });
});

// -- 6. The warning pointer, three variants --------------------------------------------------------

describe("Story 45.5 QA: the startup warning ends with the pointer in all three variants, and the pointer resolves", () => {
  type Profile = { name: string; policy: string };
  type Build = (profiles: Profile[], callable: (profile: string, key: string) => boolean, keys?: readonly string[], source?: (profile: string, key: string) => string | undefined) => string | undefined;
  const POINTER = `See "${SECTION_TITLE}" in the README.`;

  it("redact-only, block-only (re-enabled keys) and mixed each end with the pointer once, and the quoted title is a `## ` heading of the README", async () => {
    const { buildDataPolicyWarning } = await loadSharedDist<{ buildDataPolicyWarning: Build }>("data-policy.js");
    const variants: Array<[string, string | undefined]> = [
      ["redact-only", buildDataPolicyWarning([{ name: "default", policy: "redact" }], () => true)],
      ["block-only", buildDataPolicyWarning([{ name: "prod", policy: "block" }], (_profile, key) => key === "iris_sql_query", undefined, () => "env")],
      [
        "mixed",
        buildDataPolicyWarning(
          [
            { name: "default", policy: "redact" },
            { name: "prod", policy: "block" },
          ],
          () => true,
        ),
      ],
    ];
    const heading = new RegExp(`^## ${SECTION_TITLE}$`, "m");
    for (const [name, line] of variants) {
      expect(line, `${name}: the line exists`).toBeDefined();
      expect(line?.endsWith(` ${POINTER}`), `${name}: ends with the pointer`).toBe(true);
      expect(line?.split('See "').length, `${name}: quotes one title`).toBe(2);
      const title = /See "([^"]+)" in the README\.$/.exec(line ?? "")?.[1];
      expect(title, name).toBe(SECTION_TITLE);
      expect(README, `${name}: a \`## \` heading carries the quoted title`).toMatch(heading);
      expect(markdownHeadingSlugs(README).has(SECTION_SLUG), name).toBe(true);
    }
    // The three are three different lines (the mixed one is not the redact one), so the loop saw three variants.
    expect(new Set(variants.map(([, line]) => line)).size).toBe(3);
    expect(variants[1]?.[1]).toContain("under \"block\"");
    expect(variants[2]?.[1]).toContain("(redact, which covers message bodies only)");
    // The README's own example line (the "PHI data policy" section) ends with the same pointer.
    expect(squash(README)).toContain(POINTER);
  });

  it("the heading is unique: exactly one `## ` heading carries the title", () => {
    expect(README.match(new RegExp(`^## ${SECTION_TITLE}$`, "gm"))?.length).toBe(1);
  });
});
