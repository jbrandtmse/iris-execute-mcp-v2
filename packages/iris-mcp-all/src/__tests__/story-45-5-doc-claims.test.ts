/**
 * Story 45.5 -- the documents say what the safety settings protect, and every load-bearing sentence has an oracle
 * (project rules #30, #36, #43, #45, #56 and #59; AC 45.5.1 to 45.5.4; DW-766, DW-768, DW-771, DW-773, DW-784).
 *
 * The README section "What the safety settings protect" is pinned sentence by sentence against its oracle:
 *
 *  - the `block` list against `DATA_POLICY_BLOCK_KEYS` of the BUILT shared dist, in order, and the not-covered list against
 *    `DATA_POLICY_SCOPE` (the residual rows; `iris_production_logs` is governed under `block` only);
 *  - the five setup procedures against the `[ SqlProc ]` methods of `ExecuteMCPv2.Setup` in the embed (`Uninstall` is none);
 *  - "requires `%Development`" against every `Set tProps("Resource")` of `Setup.cls`; the `EnsureUnitTestRoot` sentence against
 *    that method's guard and its `ManagerDirectory()` value; "prepares with privilege checking on" against the embed's
 *    `%Prepare(.pQuery, 1)` of `ExecuteMCPv2.REST.Sql`;
 *  - the two DW-773 sentences against substrings of the built `bootstrap.js` and `MANUAL_INSTRUCTIONS`;
 *  - the audit sentence against the code: `AuditLogger` is not exported from the shared barrel, and `server-base.ts` is its only writer;
 *  - the pointer of the startup warning against `buildDataPolicyWarning`'s output and the README's `## ` headings;
 *  - Rule #56: every `IRIS_*` row of the README variable table is named in the section or classified below as not a safety setting.
 *
 * PROBE ORACLES (Rule #36). The sentences that no code in this repository can confirm rest on two recorded probes, both on a
 * throwaway IRIS for Health 2026.2 (Build 221U) of the pinned image, recorded in `spec-45-5-what-the-safety-settings-protect.md`
 * under Design Notes: "Probe A" (DW-766: the minimum account on a split layout; HTTP 500 `<PROTECT>` without `R` on the routines
 * database, HTTP 403 without `R` on the globals database) and "Probe B" (DW-771 point 3: the `ConfigureMapping` residual). The armed
 * leg of `epic45-capstone-gate.test.ts` checks the one-database form live.
 *
 * The other documents: `SECURITY.md` (C-3), `tool_support.md`, the client-config pages, the launcher README, `packages/shared/README.md`,
 * the five server READMEs, the CHANGELOG section and the changeset. Needs no IRIS. It reads the built shared dist and FAILS (never skips)
 * when that dist is stale or missing: a skip would hide a section that no longer matches the code.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, markdownHeadingSlugs } from "./pack-fixture";
import { DATA_POLICY_SCOPE } from "./data-policy-scope";
import { staleDistReason } from "./process-gate-helpers";
import {
  README,
  SECTION_SLUG,
  SECTION_TITLE,
  backtickTokens,
  blockListInReadme,
  embeddedSetupProcedures,
  loadSharedDist,
  notCoveredInReadme,
  paragraphStarting,
  proceduresInReadme,
  readRepo,
  sectionOf,
  squash,
  variableTableNames,
} from "./story-45-5-section";

const section = sectionOf();
const sec = squash(section);

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
const lineStarting = (text: string, prefix: string): string => squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");

const LINK = `README.md#${SECTION_SLUG}`;
/** The guard list of each server README's link line: the section's six guards, in its order. */
const GUARD_LIST =
  "the safety settings (governance, the presets, the confirmation dialogs, the audit log, the data policy, the SQL safety settings and the document write guards) guard the agent that uses this server, not the IRIS account";

/** The recorded probes of Story 45.5 (Rule #36): the spec's Design Notes hold the commands' results the section's sentences rest on. */
const probeRecord = (): string =>
  readFileSync(path.join(REPO_ROOT, "_bmad-output", "implementation-artifacts", "spec-45-5-what-the-safety-settings-protect.md"), "utf8");

let embed: Map<string, string>;

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale !== undefined) {
    throw new Error(`The Story 45.5 doc-claims test reads the built shared dist and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
  }
  embed = (await loadSharedDist<{ BOOTSTRAP_CLASSES: Map<string, string> }>("bootstrap-classes.js")).BOOTSTRAP_CLASSES;
});

// -- The section (AC 45.5.1) -----------------------------------------------------------------------

describe("Story 45.5: the README section exists, in the right place, and is plain (AC 45.5.1)", () => {
  it("is a `## ` heading of the README, right before `## PHI data policy`, and its slug resolves", () => {
    expect(section, "the README has the section").not.toBe("");
    expect(README).toMatch(new RegExp(`^## ${SECTION_TITLE}$`, "m"));
    expect(README.indexOf(`\n## ${SECTION_TITLE}\n`)).toBeLessThan(README.indexOf("\n## PHI data policy\n"));
    expect(README.indexOf(`\n## ${SECTION_TITLE}\n`)).toBeGreaterThan(README.indexOf("\n### Removing the IRIS Side\n"));
    expect(markdownHeadingSlugs(README).has(SECTION_SLUG)).toBe(true);
  });

  it("says the settings guard the agent and not the account, and the account is chosen first", () => {
    expect(sec).toContain("The suite's safety settings guard the agent that uses the servers. They do not guard the IRIS account.");
    expect(sec).toContain("The account's own privileges are the boundary, so choose the account first and then add the settings.");
    expect(sec).toContain("Anyone who holds the same account can call `/api/executemcp/v2`, the Atelier API or a terminal directly, and none of these settings applies to that call.");
  });

  it("names every setting that guards the agent (Rule #56, as of 2026-11-26) and says tool visibility is not a safety control (AD-7)", () => {
    const list = paragraphStarting(section, "**The settings guard the agent.**");
    expect(list, "the paragraph exists").not.toBe("");
    const settings = squash(section.slice(section.indexOf("**The settings guard the agent.**"), section.indexOf("Anyone who holds the same account")));
    for (const name of [
      "IRIS_GOVERNANCE",
      "IRIS_GOVERNANCE_FILE",
      "IRIS_GOVERNANCE_PRESET",
      "IRIS_AUDIT_LOG",
      "IRIS_DATA_POLICY",
      "IRIS_SQL_READ_ONLY",
      "IRIS_SQL_MAX_ROWS_AFFECTED",
      "IRIS_SQL_MAX_ROWS",
      "IRIS_SQL_TIMEOUT",
    ]) {
      expect(settings, name).toContain(`\`${name}\``);
    }
    expect(settings).toContain("the [confirmation dialogs](#human-confirmation-elicitation)");
    expect(settings).toContain("the document write guards");
    expect(sec).toContain("Tool visibility (`IRIS_TOOLS_PRESET`, `IRIS_TOOLS_DISABLE` and `IRIS_TOOLS_ENABLE`) only changes what the agent is shown. It is not a safety control: to stop a call, use governance.");
    expect(sec).toContain("`IRIS_AUTO_INSTALL` decides what the servers write to IRIS when they connect.");
  });

  it("Rule #56: every variable of the README's variable table is named in the section or classified here as not a safety setting", () => {
    // The classification of the rest, exhaustive as of 2026-11-26: connection, transport, tuning, discovery and visibility settings.
    const NOT_A_SAFETY_SETTING: Record<string, string> = {
      IRIS_HOST: "connection",
      IRIS_PORT: "connection",
      IRIS_USERNAME: "connection",
      IRIS_PASSWORD: "connection",
      IRIS_CREDENTIAL_NAME: "connection",
      IRIS_NAMESPACE: "connection",
      IRIS_HTTPS: "connection",
      IRIS_TIMEOUT: "connection (the HTTP request timeout)",
      IRIS_ACCEPT_LANGUAGE: "connection",
      MCP_TRANSPORT: "transport",
      IRIS_PROFILES: "connection (named instances)",
      IRIS_AUDIT_LOG_MAX_MB: "audit-log tuning (the audit log itself is named)",
      IRIS_AUDIT_LOG_PARAMS: "audit-log tuning (the audit log itself is named)",
      IRIS_TEST_TIMEOUT: "wait budget of the test tools",
      IRIS_SERVER_MANAGER: "connection discovery",
      IRIS_SM_SERVERS: "connection discovery",
      IRIS_SM_SETTINGS_PATHS: "connection discovery",
      IRIS_SM_WORKSPACE: "connection discovery",
      IRIS_CREDENTIAL_HELPER: "connection (where the password comes from)",
    };
    const named = variableTableNames(README).filter((name) => !sec.includes(`\`${name}\``));
    const unclassified = named.filter((name) => NOT_A_SAFETY_SETTING[name] === undefined);
    expect(unclassified, "variables the section neither names nor this test classifies").toEqual([]);
    // The oracle can vary: the table lists the variables at all, and a classified name is a real row.
    expect(variableTableNames(README).length).toBeGreaterThan(20);
    for (const name of Object.keys(NOT_A_SAFETY_SETTING)) {
      expect(variableTableNames(README), `${name} is a row of the README variable table`).toContain(name);
    }
  });
});

describe("Story 45.5: the account is the boundary, and the minimum account for the SQL tools (DW-766)", () => {
  it("says a `%Development` account runs code, so the database resources bound the data and SQL grants bound only the SQL tools", () => {
    expect(sec).toContain("**The account is the boundary.**");
    expect(sec).toContain("no `%All`, and SQL grants only where the agent needs them");
    expect(sec).toContain("a separate read-only account that holds `R`, never `RW`, on its database resources");
    expect(sec).toContain("The suite's web application requires the `%Development` resource (`U`).");
    expect(sec).toContain("So the database resources bound the data an account can reach, and SQL grants bound only the SQL tools.");
  });

  it("`%Development`: every web application resource Setup.cls sets is `%Development`", () => {
    const setup = embed.get("ExecuteMCPv2.Setup.cls") ?? "";
    const resources = [...setup.matchAll(/Set tProps\("Resource"\) = "([^"]*)"/g)].map((match) => match[1]);
    expect(resources.length, "Setup.cls sets the resource at least once").toBeGreaterThan(0);
    expect(new Set(resources)).toEqual(new Set(["%Development"]));
  });

  it("states Probe A's finding: `%Development:U`, the SQL grants and `R` on three database resources, with the two symptoms", () => {
    expect(sec).toContain("**The minimum account for the SQL tools.**");
    expect(sec).toContain("need `%Development:U`, the SQL grants, and `R` on three database resources. The three are often one database:");
    expect(sec).toContain("That is the routines database of the namespace the suite was installed in, where the `%ALL` mapping points. Without `R` on it, the route answers HTTP 500 with `<PROTECT>`.");
    expect(sec).toContain("The default globals database of that install namespace, where the web application runs. Without `R` on it, the route answers HTTP 403.");
    expect(sec).toContain("`R` for reads, `RW` for writes");
    expect(sec).toContain("`RW` on the routines database is not needed.");
    expect(sec).toContain("In the usual layout one database is all three, and the minimum is `%Development:U` plus the resource of that database (`%DB_<name>`).");
    expect(sec).toContain("With a split layout (globals and routines in separate databases) or a mapped one, grant `R` on each of the three.");
    // Probe A is cited, so the sentences have a recorded oracle (Rule #36).
    expect(probeRecord()).toContain("**Probe A: DW-766, the minimum account on split and mapped layouts.**");
  });

  it("the dev README appends the layout rule to the single-database blockquote and keeps the 45.1 sentence", () => {
    const dev = squash(readRepo("packages/iris-dev-mcp/README.md"));
    expect(dev).toContain("The minimum account for the SQL tools holds the `%Development` resource (`U`) and the namespace's database resource (`R` for reads, `RW` for writes), plus the SQL grants.");
    expect(dev).toContain("Default state: always on, with no setting. The minimum account holds `R` on three database resources, which are often one:");
    expect(dev).toContain("the database that holds the `ExecuteMCPv2` classes (the routines database of the namespace the suite was installed in)");
    expect(dev).toContain("without it the route answers HTTP 500 (`<PROTECT>`) or HTTP 403");
    expect(dev).toContain(`(../../${LINK})`);
    expect(dev).not.toContain("lands in Story 45.5");
  });
});

describe("Story 45.5: the read-only preset, SQL privileges and the five setup procedures (DW-771)", () => {
  it("says a SELECT can call a SqlProc method, which runs with the account's privileges, and needs EXECUTE through the suite", () => {
    expect(sec).toContain("**What the read-only preset limits.**");
    expect(sec).toContain("The preset limits statement types and the suite's write tools. It does not limit what a query can call.");
    expect(sec).toContain("A `SELECT` can call a `SqlProc` method, which runs with the account's privileges. Through the suite, that call needs `EXECUTE` on the method.");
    expect(sec).toContain("see *SQL write safety* under [Read-only mode](#read-only-mode--point-it-at-production-with-one-environment-variable)");
  });

  it("SQL privileges: the embed prepares with checking on (exactly one %Prepare, with the privilege flag), and Atelier's action/query does not check", () => {
    const sql = embed.get("ExecuteMCPv2.REST.Sql.cls") ?? "";
    expect(sql.match(/%Prepare\(/g)?.length, "exactly one %Prepare( in the SQL route class").toBe(1);
    expect(sql).toContain("tStmt.%Prepare(.pQuery, 1)");
    expect(sec).toContain("The suite prepares each SQL statement with privilege checking on, as the account it connects with.");
    expect(sec).toContain("fails with `SQLCODE -99` and nothing runs");
    expect(sec).toContain("IRIS's own Atelier `action/query` does not check SQL grants at prepare");
  });

  it("the five procedures equal the embed's SqlProc methods, and `Uninstall` is not one of them", async () => {
    const fromEmbed = await embeddedSetupProcedures();
    expect(fromEmbed, "the embed has the five").toHaveLength(5);
    expect(proceduresInReadme(section).slice().sort()).toEqual(fromEmbed.slice().sort());
    expect(fromEmbed).not.toContain("Uninstall");
    expect(sec).toContain("`Uninstall` is not one of them: see [Removing the IRIS Side](#removing-the-iris-side).");
  });

  it("point 1 and 2: SQL, Atelier included, can call all five; a limited account is refused; EnsureUnitTestRoot sets only an empty ^UnitTestRoot to the manager directory", () => {
    expect(sec).toContain("SQL can call all five, Atelier's `action/query` included, and Atelier skips the `EXECUTE` check. The account's privileges are the boundary.");
    // Each refusal names its own cause (decision #165): the missing EXECUTE privilege at prepare through the suite, and `<PROTECT>` at run
    // time without %Admin_Manage through Atelier, which skips the EXECUTE check.
    expect(sec).toContain("A limited account cannot make `Configure` or `ConfigureMapping` change anything.");
    expect(sec).toContain("Through `iris_sql_query`, an account without the `EXECUTE` privilege on them is refused when the statement is prepared, with `SQLCODE -99`, and nothing runs.");
    expect(sec).toContain("Through Atelier, which skips that check, both run and fail with `<PROTECT>` for an account without `%Admin_Manage`, and nothing changes.");
    expect(sec).not.toMatch(/without `%Admin_Manage`[^.]*refused when the statement is prepared/);
    expect(sec).toContain("`IsConfigured` and `GetBootstrapVersion` only read, and `EnsureUnitTestRoot` only sets an empty `^UnitTestRoot`, to the IRIS manager directory, and notes that in the install record.");
    const setup = embed.get("ExecuteMCPv2.Setup.cls") ?? "";
    const body = setup.slice(setup.indexOf("ClassMethod EnsureUnitTestRoot("), setup.indexOf("ClassMethod GetBootstrapVersion("));
    expect(body).toContain('If $Get(^UnitTestRoot) = ""');
    expect(body).toContain("Set ^UnitTestRoot = $System.Util.ManagerDirectory()");
    expect(body.match(/Set \^UnitTestRoot/g)?.length, "the only write of the global").toBe(1);
    expect(body.match(/\bSet \^|\bKill\b/g)?.length, "no other global write or kill in the method").toBe(1);
    expect(body.match(/Do \.\.WriteRecord\(\$NAMESPACE, "unitTestRoot", \^UnitTestRoot\)/g)?.length, "the install-record write").toBe(1);
  });

  it("point 3 (amendment A2, Probe B): the ConfigureMapping residual is stated as probed, and the code can create what it puts back", () => {
    expect(sec).toContain("An administrator account, such as one with `%All`, can call `Configure` and `ConfigureMapping` through a `SELECT` in `iris_sql_query`, the read tool a read-only server keeps.");
    // Probe B made every call as `_SYSTEM` (`%All`), so that is the account the residual names.
    expect(probeRecord()).toContain("Every call below is made as `_SYSTEM`");
    expect(sec).toContain("`iris_sql_query` rolls the statement back. That undoes the change `Configure` makes to the web application, but not the effect of `ConfigureMapping`:");
    expect(sec).toContain("when the `%ALL` namespace or the `ExecuteMCPv2` mapping is missing, the call puts them back in `iris.cpf` and in the running configuration, while `Config.Namespaces` and `Config.MapPackages` report them absent.");
    expect(sec).toContain("Called without a rollback, through Atelier's `action/query`, `Configure` can point the web application at another namespace.");
    expect(sec).toContain("This release documents this and does not change it.");
    expect(probeRecord()).toContain("**Probe B: DW-771 point 3 (Rule #42).**");
    const setup = embed.get("ExecuteMCPv2.Setup.cls") ?? "";
    const body = setup.slice(setup.indexOf("ClassMethod ConfigureMapping("), setup.indexOf("ClassMethod IsConfigured("));
    expect(body).toContain('Config.Namespaces).Create("%ALL"');
    expect(body).toContain('Config.MapPackages).Create("%ALL", "ExecuteMCPv2"');
    expect(sec, "the residual does not claim a fix").not.toMatch(/\b(?:is|was|has been) fixed\b/);
  });

  it("point 4: the mitigations are a least-privilege account or `block`", () => {
    expect(sec).toContain("The mitigations are a least-privilege account, which is refused on all five procedures through `iris_sql_query`, or `IRIS_DATA_POLICY=block`, which turns `iris_sql_query` off.");
  });
});

describe("Story 45.5: the data policy, the audit log and a least-privilege account (DW-784, DW-773)", () => {
  it("the `block` list equals DATA_POLICY_BLOCK_KEYS of the built shared dist, in order", async () => {
    const { DATA_POLICY_BLOCK_KEYS } = await loadSharedDist<{ DATA_POLICY_BLOCK_KEYS: readonly string[] }>("data-policy.js");
    expect(DATA_POLICY_BLOCK_KEYS).toHaveLength(12);
    expect(blockListInReadme(section)).toEqual([...DATA_POLICY_BLOCK_KEYS]);
    expect(sec).toContain("An explicit governance key re-enables one, and the startup warning names it.");
  });

  it("the not-covered tools are residual rows of the scope table (the Event Log text is governed under `block` only)", () => {
    const listed = notCoveredInReadme(section);
    expect(listed).toEqual(["iris_sql_query", "iris_sql_execute", "iris_global_get", "iris_global_list", "iris_production_logs"]);
    for (const tool of listed.filter((name) => name !== "iris_production_logs")) {
      expect(DATA_POLICY_SCOPE[tool]?.scope, `${tool} is residual`).toBe("residual");
    }
    expect(DATA_POLICY_SCOPE["iris_production_logs"]?.scope).toBe("governed");
    expect(DATA_POLICY_SCOPE["iris_production_logs"]?.reason).toContain("Governed under block only");
    expect(sec).toContain("`redact`, the default, covers the message tools only.");
  });

  it("DW-784: `iris_sql_analyze` stats and running are under probe, and the scope table keeps its verdict `on`", () => {
    expect(sec).toContain("The `stats` and `running` actions of `iris_sql_analyze` may show the statement text of other sessions. That is under probe, and the tool stays on under `block`.");
    expect(DATA_POLICY_SCOPE["iris_sql_analyze"]).toMatchObject({ scope: "residual", block: "on" });
    const row = lineStarting(readRepo("tool_support.md"), "| `iris_sql_analyze` |");
    expect(row).toContain("| residual | on |");
    expect(row).toContain("`stats` and `running` may show other sessions' statement text; under probe (DW-784).");
  });

  it("the audit log records MCP tool calls only: AuditLogger is not exported from the shared barrel, and server-base.ts is its one writer", () => {
    expect(sec).toContain("**The audit log records MCP tool calls only.** A direct REST or Atelier call with the same account is not in it.");
    expect(sec).toContain("see `iris_audit_manage` and `iris_audit_events`");
    expect(readRepo("packages/shared/src/index.ts")).not.toContain("AuditLogger");
    const writers: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && readFileSync(full, "utf8").includes("new AuditLogger(")) {
          writers.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(REPO_ROOT, "packages"));
    expect(writers).toEqual(["packages/shared/src/server-base.ts"]);
  });

  it("DW-773: the two outcomes quote the built bootstrap.js and MANUAL_INSTRUCTIONS", async () => {
    const bootstrapText = readFileSync(path.join(REPO_ROOT, "packages", "shared", "dist", "bootstrap.js"), "utf8");
    const { MANUAL_INSTRUCTIONS } = await loadSharedDist<{ MANUAL_INSTRUCTIONS: string }>("bootstrap.js");
    const unconfirmed = "could not confirm that the /api/executemcp/v2 web application is registered";
    const needsAdmin = "registration requires %Admin_Manage privileges";
    expect(bootstrapText).toContain(unconfirmed);
    expect(squash(MANUAL_INSTRUCTIONS)).toContain(needsAdmin);
    expect(sec).toContain("**A least-privilege account and the automatic install.**");
    expect(sec).toContain(`which says it \`${unconfirmed}\`. The tools run.`);
    expect(sec).toContain(`a warning that says \`${needsAdmin}\`. The tools run.`);
    expect(sec).toContain("Install off (`IRIS_AUTO_INSTALL=false`, or the read-only preset): the server logs one warning on every start");
    expect(sec).toContain("Install on: every connect recompiles the classes");
    expect(sec).toContain("So install the IRIS side once as an administrator (start one server with the install on, or use IPM), and then connect the limited account with `IRIS_AUTO_INSTALL=false` or the read-only preset.");
    expect(sec).toContain("[Removing the IRIS Side](#removing-the-iris-side)");
    expect(sec).toContain("[Set environment variables](#2-set-environment-variables)");
  });

  it("the section makes no compliance claim and names no email address", () => {
    expect(sec).not.toMatch(/\bcompliant\b|\bcertif|\bHIPAA\b|\bGDPR\b|\bSOC ?2\b/i);
    expect(sec).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });
});

// -- Every link resolves (AC 45.5.2) ---------------------------------------------------------------

describe("Story 45.5: the section is linked where each reader looks, and every link resolves (AC 45.5.2)", () => {
  const slugs = markdownHeadingSlugs(README);

  it("the README anchors it from the governance variable rows, the CLI section, the cascade and 'Who can run it'", () => {
    for (const variable of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_PRESET", "IRIS_GOVERNANCE_FILE", "IRIS_AUDIT_LOG", "IRIS_DATA_POLICY"]) {
      expect(lineStarting(README, `| \`${variable}\` |`), variable).toContain(`(#${SECTION_SLUG})`);
    }
    const cliStart = README.indexOf("#### `iris-mcp-governance` CLI");
    const cli = squash(README.slice(cliStart, README.indexOf("| Command | Effect |", cliStart)));
    expect(cli.length, "the CLI section intro was found").toBeGreaterThan(200);
    expect(cli).toContain(`[What the safety settings protect](#${SECTION_SLUG})`);
    const who = squash(README.slice(README.indexOf("**Who can run it.**"), README.indexOf("The coverage tools' scratch global")));
    expect(who).toContain(`This is the same line the settings draw: see [What the safety settings protect](#${SECTION_SLUG}).`);
  });

  it("the five server READMEs carry the link line in their Configuration section", () => {
    for (const pkg of ["dev", "admin", "interop", "ops", "data"]) {
      const text = readRepo(`packages/iris-${pkg}-mcp/README.md`);
      const at = text.indexOf("> **What the safety settings protect:**");
      expect(at, `${pkg}: the link line exists`).toBeGreaterThan(-1);
      expect(at, `${pkg}: inside the Configuration section`).toBeGreaterThan(text.indexOf("\n## Configuration"));
      expect(at, `${pkg}: before MCP Client Configuration`).toBeLessThan(text.indexOf("\n## MCP Client Configuration"));
      expect(squash(text.slice(at, at + 700))).toContain(`(../../${LINK})`);
      // The same six guards as the section's list (governance and the presets, the dialogs, the audit log, the data policy, the SQL
      // safety settings and the document write guards), so no reader of one server's README sees a shorter list.
      expect(squash(text.slice(at, at + 700)), pkg).toContain(GUARD_LIST);
    }
    expect(sec, "the section lists the SQL safety settings").toContain("- the SQL safety settings (");
    expect(sec, "the section lists the document write guards").toContain("- the document write guards.");
  });

  it("every link to the section, in every reader document, points at a real heading", () => {
    const docs = [
      "README.md",
      "SECURITY.md",
      "tool_support.md",
      "CHANGELOG.md",
      "docs/client-config/claude-code.md",
      "docs/client-config/claude-desktop.md",
      "docs/client-config/cursor.md",
      "packages/shared/README.md",
      ...["dev", "admin", "interop", "ops", "data"].map((pkg) => `packages/iris-${pkg}-mcp/README.md`),
    ];
    let found = 0;
    for (const doc of docs) {
      for (const match of readRepo(doc).matchAll(/\]\(([^)\s]*)#what-the-safety-settings-protect\)/g)) {
        found += 1;
        const target = match[1] as string;
        if (target === "") {
          expect(slugs.has(SECTION_SLUG), `${doc}`).toBe(true);
          continue;
        }
        const resolved = path.resolve(path.dirname(path.join(REPO_ROOT, doc)), target);
        expect(path.relative(REPO_ROOT, resolved), `${doc} links ${target}`).toBe("README.md");
      }
    }
    expect(found, "the links exist at all").toBeGreaterThanOrEqual(14);
  });

  it("the cascade text names the data policy seed in all three places (45.4 updated only the CLI row)", () => {
    const flat = squash(README);
    expect(flat).toContain("effective = env.profile(key) ?? env.global(key) ?? file.profile(key) ?? file.global(key) ?? inheritedDisable(key) ?? dataPolicySeed(key) ?? presetSeed(key) ?? defaultSeed(key)");
    expect(flat).toContain("otherwise the **data policy seed**, which under a profile's `block` [data policy](#phi-data-policy) disables the raw-read and code-execution keys");
    expect(flat).toContain("?? inheritedDisable ?? dataPolicySeed ?? preset ?? default seed`): a file introduced later");
    expect(flat).toContain("The cascade is `profile.explicit ?? global.explicit ?? inheritedDisable ?? dataPolicySeed ?? preset ?? defaultSeed`:");
  });
});

// -- SECURITY.md (AC 45.5.3, C-3) ------------------------------------------------------------------

describe("Story 45.5: SECURITY.md narrows its scope and adds no email address (AC 45.5.3, C-3)", () => {
  const policy = squash(readRepo("SECURITY.md"));

  it("says getting past a control through the servers' tools is in scope and using the account directly is not", () => {
    expect(policy).toContain("The authorization model is IRIS's own: the servers act as the IRIS user they connect with, and what that user may do is decided by IRIS.");
    expect(policy).toContain("guard the agent that uses the servers, not the IRIS account");
    expect(policy, "the scope names the same six guards as the README section").toContain(
      "(governance and the presets, the confirmation dialogs, the audit log, the data policy, the SQL safety settings and the document write guards)",
    );
    expect(policy).toContain("Anyone who holds the account can call IRIS directly, and none of those settings applies to that call.");
    expect(policy).toContain("Also in scope: a way to get past one of those controls through the servers' own tools, for example a tool call that runs an action governance turned off, or that returns data the data policy should withhold.");
    expect(policy).toContain("Out of scope:");
    expect(policy).toContain("using the IRIS account directly (the REST service, the Atelier API or a terminal), which IRIS privileges govern;");
    expect(policy).toContain("a finding that depends on giving the account more privileges than it needs;");
    expect(policy).toContain("a residual that [What the safety settings protect](README.md#what-the-safety-settings-protect) already documents.");
    expect(policy.indexOf("Out of scope:")).toBeGreaterThan(policy.indexOf("Also in scope:"));
  });

  it("links the section with a link that resolves, holds no email address and no compliance claim, and keeps the 42.5 strings", () => {
    expect(markdownHeadingSlugs(README).has(SECTION_SLUG)).toBe(true);
    expect(policy).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(policy).not.toMatch(/\bcompliant\b|\bcertif/i);
    expect(policy).toContain("No email address is published for security reports");
    expect(policy).toContain("**Fix forward.**");
  });
});

// -- The other documents (AC 45.5.4, DW-768) -------------------------------------------------------

describe("Story 45.5: the documents that lacked the automatic install name it now (AC 45.5.4, DW-768)", () => {
  it("tool_support.md: the dated 45.5 note, the dependency section and the scope paragraph", () => {
    const toolSupport = readRepo("tool_support.md");
    const note = lineStarting(toolSupport, "> **Story 45.5 (2026-11-26)");
    expect(note, "the note exists").not.toBe("");
    expect(note).toContain("governance defaults, the trust model:");
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves (110 package tools, 115 advertised;");
    expect(note).toContain("`BOOTSTRAP_VERSION` is unchanged");
    expect(note).toContain('`See "What the safety settings protect" in the README.`');
    expect(note).toContain("`S-45.4-block-raw-tools`");
    expect(toolSupport.indexOf("> **Story 45.4"), "after the 45.4 note").toBeLessThan(toolSupport.indexOf("> **Story 45.5"));

    const flat = squash(toolSupport.slice(toolSupport.indexOf("### The automatic install can be off")));
    expect(flat).toContain("### The automatic install can be off: `IRIS_AUTO_INSTALL`");
    expect(flat).toContain("a profile's `autoInstall` in `IRIS_PROFILES` wins over the variable");
    expect(flat).toContain("`IRIS_SIDE_NOT_INSTALLED`");
    expect(flat).toContain("the read-only preset (`IRIS_GOVERNANCE_PRESET=read-only`) turns it off");
    expect(toolSupport.indexOf("### The automatic install can be off")).toBeGreaterThan(toolSupport.indexOf("## Dependency implications"));
    expect(toolSupport.indexOf("### The automatic install can be off")).toBeLessThan(toolSupport.indexOf("### Pre-publish implication"));

    const scope = squash(toolSupport.slice(toolSupport.indexOf("A restriction on a residual tool is")));
    expect(scope).toContain("The data policy, like governance, guards the agent in the MCP process and not the IRIS account");
    expect(scope).toContain(`[What the safety settings protect](${LINK})`);
  });

  for (const page of ["claude-code", "claude-desktop", "cursor"]) {
    it(`${page}.md: the read-only section names the automatic install, the refusal and the link, and keeps the 38.6 sentence`, () => {
      const text = squash(readRepo(`docs/client-config/${page}.md`));
      expect(text).toContain("All five are **optional**");
      expect(text).toContain("The read-only preset also turns the automatic install off.");
      expect(text).toContain("`IRIS_AUTO_INSTALL` is on by default, and a profile can set its own `autoInstall` in `IRIS_PROFILES`.");
      expect(text).toContain("a missing or older IRIS side makes the custom-REST tools answer `IRIS_SIDE_NOT_INSTALLED`, while the Atelier-only tools keep working.");
      expect(text).toContain("An explicit `IRIS_AUTO_INSTALL=true` (or `autoInstall: true`) together with the read-only preset fails startup.");
      expect(text).toContain("[What the safety settings protect](../../README.md#what-the-safety-settings-protect)");
      expect(text.indexOf("The read-only preset also turns the automatic install off.")).toBeGreaterThan(text.indexOf("All five are **optional**"));
    });
  }

  it("the launcher README lists IRIS_AUTO_INSTALL among the variables it leaves alone, and says its default and scope", () => {
    const text = squash(readRepo("extensions/iris-mcp-launcher/README.md"));
    expect(text).toContain("`IRIS_DATA_POLICY`, `IRIS_AUTO_INSTALL`, `IRIS_ACCEPT_LANGUAGE`) are deliberately left alone and still inherit.");
    expect(text).toContain("`IRIS_AUTO_INSTALL` is unset by default, which means on (except under the read-only preset, which turns it off), and is global:");
    expect(text).toContain("a profile's own `autoInstall` is a field of its `IRIS_PROFILES` entry, and the launcher writes none.");
    // The launcher source has no handling of the variable, so it inherits (Code Map oracle).
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? (entry.name === "__tests__" || entry.name === "node_modules" ? [] : walk(full)) : [full];
      });
    const sources = walk(path.join(REPO_ROOT, "extensions", "iris-mcp-launcher", "src")).filter((file) => /\.ts$/.test(file));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((file) => /AUTO_INSTALL|autoInstall/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("the shared README lists every Epic 45 export and the refusal code, and each runtime export is a real export of the built dist", async () => {
    const shared = squash(readRepo("packages/shared/README.md"));
    const runtime = [
      "IrisSideNotInstalledError",
      "recordSideRefusal",
      "AUTO_INSTALL_ENV_VAR",
      "parseOperatorAutoInstall",
      "resolveAutoInstall",
      "applyAutoInstall",
      "buildIrisSideRefusal",
      "DATA_POLICY_BLOCK_KEYS",
      "DATA_POLICY_BLOCK_KEYS_AS_OF",
      "dataPolicySeed",
      "buildDataPolicyWarning",
    ];
    const types = ["IrisSideRefusal", "SideRefusalRecorder", "AutoInstallSource", "AutoInstallCarrier", "DataPolicyWarningProfile"];
    const barrel = await loadSharedDist<Record<string, unknown>>("index.js");
    const barrelSource = readRepo("packages/shared/src/index.ts");
    // A function is listed as `name()`, a constant or a type as `name`.
    const listed = (name: string): boolean => shared.includes(`\`${name}\``) || shared.includes(`\`${name}()\``);
    for (const name of runtime) {
      expect(barrel[name], `${name} is exported by the built shared dist`).toBeDefined();
      expect(listed(name), `${name} is in the shared README`).toBe(true);
    }
    for (const name of types) {
      expect(barrelSource, `${name} is exported by the shared barrel`).toContain(name);
      expect(listed(name), `${name} is in the shared README`).toBe(true);
    }
    const { REFUSAL_CODES } = barrel as { REFUSAL_CODES: Record<string, string> };
    expect(REFUSAL_CODES["IRIS_SIDE_NOT_INSTALLED"]).toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(shared).toContain("**`REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED`**");
    expect(shared).toContain("`structuredContent` is `{code, profile, namespace, found, deployedVersion?, requiredVersion, autoInstallSource}` as `buildIrisSideRefusal` builds it.");
    expect(shared).toContain("The audit log records it as `error`, not `denied`.");
  });
});

// -- The warning's pointer (decision #170) ---------------------------------------------------------

describe("Story 45.5: the startup warning points to the section, and the pointer resolves (decision #170)", () => {
  it("buildDataPolicyWarning's built output ends with the new pointer, which is the title of a `## ` heading of README.md", async () => {
    const { buildDataPolicyWarning } = await loadSharedDist<{
      buildDataPolicyWarning: (profiles: Array<{ name: string; policy: string }>, isCallable: () => boolean) => string | undefined;
    }>("data-policy.js");
    for (const policy of ["redact", "block"]) {
      const line = buildDataPolicyWarning([{ name: "default", policy }], () => true) as string;
      expect(line, policy).toMatch(/ See "([^"]+)" in the README\.$/);
      const title = /See "([^"]+)" in the README\.$/.exec(line)?.[1];
      expect(title).toBe(SECTION_TITLE);
      expect(README, "a `## ` heading carries the quoted title").toMatch(new RegExp(`^## ${title}$`, "m"));
      expect(markdownHeadingSlugs(README).has(SECTION_SLUG)).toBe(true);
    }
  });

  it("no document, test or changeset names the old pointer any more (the text is assembled so this file does not hold it)", () => {
    const old = ["See \"PHI data policy\"", " in the README"].join("");
    const roots = ["README.md", "CHANGELOG.md", "tool_support.md", "SECURITY.md", ".changeset"];
    const files: string[] = [];
    for (const root of roots) {
      const full = path.join(REPO_ROOT, root);
      if (!existsSync(full)) continue;
      if (root === ".changeset") for (const entry of readdirSync(full)) files.push(path.join(full, entry));
      else files.push(full);
    }
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") continue;
          walk(full);
        } else if (/\.(ts|md|mjs)$/.test(entry.name)) files.push(full);
      }
    };
    // Every tree a reader or a release reads: the packages, the client-config pages, the launcher and the scripts.
    for (const tree of ["packages", "docs", "extensions", "scripts"]) walk(path.join(REPO_ROOT, tree));
    expect(files.some((file) => file.endsWith(path.join("docs", "client-config", "claude-code.md"))), "the walk reaches docs/").toBe(true);
    expect(files.some((file) => file.endsWith(path.join("iris-mcp-launcher", "README.md"))), "the walk reaches extensions/").toBe(true);
    expect(files.filter((file) => readFileSync(file, "utf8").includes(old)).map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
    expect(squash(readRepo("CHANGELOG.md"))).toContain("The line points to the README's \"What the safety settings protect\" section and names the ways out");
  });
});

// -- The CHANGELOG section and the changeset (AC 45.5.4, decision #160) -----------------------------

describe("Story 45.5: the CHANGELOG section and the changeset", () => {
  const changelog = readRepo("CHANGELOG.md");
  const heading = "## [Unreleased] - Story 45.5: What the Safety Settings Protect";
  const start = changelog.indexOf(heading);
  const entry = squash(changelog.slice(start, changelog.indexOf("\n## [Unreleased] - Story 45.4", start)));

  it("is the section above Story 45.4's, and says what changed, the narrowed scope (C-3) and the release handoff", () => {
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(changelog.indexOf("## [Unreleased] - Story 45.4"));
    expect(entry).toContain("answering GitHub issue #1 points 1, 2 and 4");
    expect(entry).toContain("`BOOTSTRAP_VERSION` is unchanged");
    expect(entry).toContain("`S-45.4-block-raw-tools`");
    expect(entry).toContain('`See "What the safety settings protect" in the README.`');
    expect(entry).toContain("The `SECURITY.md` scope is narrower and says so (C-3).");
    // The release notes name each refusal's own cause, as the README section does (decision #165).
    expect(entry).toContain("Through `iris_sql_query`, an account without the `EXECUTE` privilege on them is refused when the statement is prepared (`SQLCODE -99`)");
    expect(entry).toContain("An administrator account, such as one with `%All`, can call `Configure` and `ConfigureMapping` through `iris_sql_query`");
    expect(entry).not.toContain("An account that holds `%Admin_Manage`, called through `iris_sql_query`");
    expect(entry).toContain("No email address is added.");
    expect(entry).toContain("### Release handoff (1.3.0)");
    expect(entry).toContain("The release notes must state the narrowed `SECURITY.md` scope");
    expect(entry).toContain("the new warning pointer");
    expect(entry).toContain("This release documents it and changes no code.");
    expect(entry, "no compliance claim").not.toMatch(/\bcompliant\b|\bcertif/i);
  });

  // `changeset version` consumes (deletes) the file, so its checks run only while it exists.
  const CHANGESET = ".changeset/story-45-5-what-the-safety-settings-protect.md";
  const present = existsSync(path.join(REPO_ROOT, CHANGESET));
  it.skipIf(!present)("the changeset bumps the six @iris-mcp packages by minor (decision #160) and names the pointer", () => {
    const text = readRepo(CHANGESET);
    for (const pkg of ["shared", "admin", "data", "dev", "interop", "ops"]) {
      expect(text, pkg).toContain(`"@iris-mcp/${pkg}": minor`);
    }
    expect(text).not.toMatch(/: (?:major|patch)\b/);
    expect(squash(text)).toContain('`See "What the safety settings protect" in the README.`');
    expect(squash(text)).toContain("`SECURITY.md` scope (a release note)");
  });
});
