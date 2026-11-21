/**
 * Story 42.4 (AC 42.4.2, AC 42.4.4; DW-34, DW-674) -- `scripts/ci-ipm-archive.mjs` and its helpers (`scripts/lib/ipm-archive.mjs`), held in
 * the default suite WITHOUT a container engine.
 *
 *  - THE HELPERS. Staging from an embed (and its refusals), the declarations a manifest makes, the comparison of an archive with the embed
 *    over a real `tar czf` fixture, the split session markers and how they are read back, the parity comparison.
 *  - THE SERVED ARCHIVE (Story 42.8, DW-694; decision #122). What the IPM registry downloads is GitHub's archive of the repository: the
 *    member judgement (`registryArchiveProblems`), the removal of GitHub's wrapping folder, the byte-for-byte comparison with
 *    `git archive`, and what the leg expects to install (read from the committed tree), each over real `tar czf` archives of the real tree.
 *  - THE VERB SET (AC 42.4.4). The IPM verbs the session scripts issue equal `IPM_VERBS` in both directions, and none is `publish`,
 *    `install`, `repo`, `enable` or `update`: held over every script builder, over the source text of both files, and over the scripts a
 *    full scripted run feeds to its sessions.
 *  - THE SCRIPTED RUN. The script runs as a REAL process against the scripted docker of `fake-docker.ts`, whose session handler plays the
 *    IPM and IRIS side of every phase (`SESSION_HANDLER` below). A full run passes on both editions; each phase's fault ends the run with exit
 *    1 naming the phase and the edition, every container removed (the log of the failing one printed first) and the temporary directory
 *    gone; every container is started `--network none` with no `-p`; a signal during a session removes everything. The served leg runs
 *    against a stand-in `git` and, in the CI rows, a stand-in `fetch` (an `--import` preload) that answer from real tar archives of the
 *    real tree; the URL the script builds from `GITHUB_REPOSITORY` and `GITHUB_SHA` is what the stand-in records.
 *
 * Nothing here reaches a network or runs docker. The real IPM and IRIS behavior (what `load`, `package` and the install guard actually
 * do) is shown by running `node scripts/ci-ipm-archive.mjs` on throwaway containers, in CI's `ipm` job.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EDITIONS, PhaseFailure, parseArgs, runIpmArchive } from "../../../../scripts/ci-ipm-archive.mjs";
import { findExecutable } from "../../../../scripts/throwaway-iris.mjs";
import { GIT_VERBS, defaultServedDeps } from "../../../../scripts/lib/served-archive.mjs";
import { ipmTreeMarker, renderModuleXml } from "../../../../scripts/lib/ipm-tree.mjs";
import { copyGeneratorInputs } from "../../../shared/src/__tests__/gen-bootstrap-scratch";
import {
  ABSENT_DOCUMENT,
  FORBIDDEN_IPM_VERBS,
  GUARD_DOCUMENT,
  GUARD_REFUSAL_TEXT,
  IPM_VERBS,
  archiveEqualityProblems,
  archiveNames,
  archiveProblems,
  classPathSegments,
  deleteSetupScript,
  embedProblems,
  extractEntries,
  importIpmScript,
  installChecksScript,
  ipmCommandScript,
  ipmVerbsOf,
  listOutputScript,
  listedVersion,
  loadSyntheticSetupScript,
  manifestDeclarations,
  manifestProblems,
  markerSemver,
  markerStatement,
  markerValue,
  moduleMemberSet,
  normalizeText,
  outputDirectoryScript,
  parityProblems,
  parityScript,
  readTgz,
  registryArchiveProblems,
  registryArchiveScript,
  registryTarCommand,
  repositoriesScript,
  seedMarkers,
  servedArchiveUrl,
  sessionScript,
  setupStateScript,
  stageModule,
  stripArchivePrefix,
  stripTerminal,
  synthesizedSetup,
  treeExpectations,
} from "../../../../scripts/lib/ipm-archive.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION, IPM_INSTALL_GUARD } from "../../../shared/src/bootstrap-classes.js";
import { classifyDeployedMarker, parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";
import { installFakeDocker, type FakeDocker } from "./fake-docker";
import {
  SERVED_PREFIX,
  SERVED_REPOSITORY,
  SERVED_SHA,
  fakeFetchCalls,
  fakeGitCalls,
  filesUnder,
  gitArchiveOf,
  githubArchiveOf,
  installFakeGit,
  realEmbed,
  realTreeMembers,
  tarGz,
  writeFetchPreload,
  writeServedRepository,
  type Embed,
} from "./ipm-archive-fixture";
import { staleDistReason } from "./process-gate-helpers.js";

const SCRIPT = path.join(REPO_ROOT, "scripts", "ci-ipm-archive.mjs");
const PARITY_FIXTURE = path.join(REPO_ROOT, "packages", "shared", "src", "__tests__", "fixtures", "bootstrap-marker-parity-cases.json");

interface ParityCase {
  note: string;
  deployed: string;
  embedded: string;
  expected: string;
}

const scratch: string[] = [];
function scratchDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ci-ipm-archive-test-"));
  scratch.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A small synthetic embed: a Setup, two more classes and a guard, all stamped with one marker. */
function syntheticEmbed(overrides: Partial<Embed> = {}): Embed {
  const marker = "1.2.3+4.aaaaaaaaaaaa";
  const stamped = (name: string, body = "") => `Class ${name}\n{\nParameter BOOTSTRAPVERSION = "${marker}";\n${body}\n}\n`;
  const classes = new Map<string, string>([
    ["ExecuteMCPv2.Utils.cls", "Class ExecuteMCPv2.Utils\n{\n}\n"],
    ["ExecuteMCPv2.Setup.cls", stamped("ExecuteMCPv2.Setup")],
    ["ExecuteMCPv2.REST.Dispatch.cls", "Class ExecuteMCPv2.REST.Dispatch\n{\n}\n"],
  ]);
  const moduleXml = renderModuleXml({
    moduleName: "iris-execute-mcp-v2",
    version: "1.2.3",
    classNames: [...classes.keys()],
    guardName: "ExecuteMCPv2.InstallGuard.cls",
  });
  return {
    marker,
    classes,
    guard: { name: "ExecuteMCPv2.InstallGuard.cls", content: stamped("ExecuteMCPv2.InstallGuard") },
    moduleName: "iris-execute-mcp-v2",
    moduleXml,
    classify: classifyDeployedMarker,
    parse: parseBootstrapMarker,
    ...overrides,
  };
}

// -- the helpers ---------------------------------------------------------------------------

describe("stageModule (AD-14: the archive is built from the embed, never from src/)", () => {
  it("writes module.xml, one ipm/src/cls/<package path>.cls per embedded class and the preloaded guard under preload/, readable by everyone", () => {
    const directory = scratchDir();
    const embed = syntheticEmbed();

    const { files } = stageModule(directory, embed);

    expect(filesUnder(directory).sort()).toEqual(
      [
        "module.xml",
        "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls",
        "ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls",
        "ipm/src/cls/ExecuteMCPv2/Setup.cls",
        "ipm/src/cls/ExecuteMCPv2/Utils.cls",
      ].sort(),
    );
    expect(files.sort()).toEqual(filesUnder(directory).sort());
    expect(readFileSync(path.join(directory, "ipm/src/cls/ExecuteMCPv2/Setup.cls"), "utf8")).toBe(embed.classes.get("ExecuteMCPv2.Setup.cls"));
    expect(readFileSync(path.join(directory, "module.xml"), "utf8")).toBe(embed.moduleXml);
    for (const file of files) expect(statSync(path.join(directory, file)).mode & 0o777, file).toBe(0o644);
    for (const sub of ["", "ipm", "ipm/src", "ipm/src/cls", "ipm/src/cls/ExecuteMCPv2", "ipm/src/cls/ExecuteMCPv2/REST", "preload", "preload/ipm/src/cls"]) {
      expect(statSync(path.join(directory, sub)).mode & 0o755, sub || "the stage").toBe(0o755);
    }
  });

  it("stages the real embed: 35 classes, the guard, the manifest, and nothing from src/ or any test class", () => {
    const directory = scratchDir();

    const { files } = stageModule(directory, realEmbed());

    expect(files.filter((file) => file.startsWith("ipm/src/cls/") && file.endsWith(".cls"))).toHaveLength(35);
    expect(files).toContain("preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls");
    expect(files.some((file) => /Tests|QAFixtures/.test(file))).toBe(false);
    for (const [name, content] of BOOTSTRAP_CLASSES) {
      expect(readFileSync(path.join(directory, "ipm", "src", "cls", ...classPathSegments(name)), "utf8").trimEnd()).toBe(content.trimEnd());
    }
  });

  it("stages the layout the committed tree has: the same manifest path, the guard under preload/, every class under ipm/src/cls (the build leg and the tree share one path map)", () => {
    const directory = scratchDir();
    const { files } = stageModule(directory, realEmbed());
    const tree = realTreeMembers();

    expect(files).toContain("module.xml");
    expect(tree).toContain("module.xml");
    expect(files.filter((file) => file.startsWith("preload/"))).toEqual(tree.filter((file) => file.startsWith("preload/")));
    expect(files.filter((file) => file !== "module.xml" && !file.startsWith("preload/")).every((file) => file.startsWith("ipm/src/cls/ExecuteMCPv2/"))).toBe(true);
    expect(tree.filter((file) => file !== "module.xml" && !file.startsWith("preload/")).every((file) => file.startsWith("ipm/src/cls/ExecuteMCPv2/"))).toBe(true);
  });

  it.each([
    ["a class that still holds the dev placeholder", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Utils.cls", 'Class ExecuteMCPv2.Utils\n{\nParameter BOOTSTRAPVERSION = "dev";\n}\n'), /dev placeholder/],
    ["a guard that still holds the dev placeholder", (embed: Embed) => (embed.guard = { ...embed.guard, content: embed.guard.content.replace(embed.marker, "dev") }), /dev placeholder/],
    ["a Setup stamped with another marker", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Setup.cls", `Class ExecuteMCPv2.Setup\n{\nParameter BOOTSTRAPVERSION = "9.9.9+9.bbbbbbbbbbbb";\n}\n`), /stamps the marker "9\.9\.9\+9\.bbbbbbbbbbbb"/],
    ["a guard stamped with another marker", (embed: Embed) => (embed.guard = { ...embed.guard, content: embed.guard.content.replace(embed.marker, "9.9.9+9.bbbbbbbbbbbb") }), /ExecuteMCPv2\.InstallGuard\.cls stamps the marker/],
    ["a Setup with no marker line", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Setup.cls", "Class ExecuteMCPv2.Setup\n{\n}\n"), /stamps the marker undefined/],
    ["a test class among the classes", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Tests.UtilsTest.cls", "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n"), /test or fixture class/],
    ["a fixture class among the classes", (embed: Embed) => embed.classes.set("ExecuteMCPv2.QAFixtures.Thing.cls", "Class ExecuteMCPv2.QAFixtures.Thing\n{\n}\n"), /test or fixture class/],
    ["a manifest for another module", (embed: Embed) => (embed.moduleXml = embed.moduleXml.replace("<Name>iris-execute-mcp-v2</Name>", "<Name>other</Name>")), /names the module "other"/],
  ])("refuses %s, and writes nothing", (_label, change, problem) => {
    const directory = scratchDir();
    const embed = syntheticEmbed();
    change(embed);

    expect(() => stageModule(directory, embed)).toThrow(problem);
    expect(readdirSync(directory)).toEqual([]);
    expect(embedProblems(embed).join(" ")).toMatch(problem);
  });

  it("accepts the embed it is given when every class carries the marker", () => {
    expect(embedProblems(syntheticEmbed())).toEqual([]);
    expect(embedProblems(realEmbed())).toEqual([]);
  });

  it("expects the guard refusal text that the embedded install guard builds, so rewording the guard cannot leave the proof expecting words it never prints", () => {
    expect(IPM_INSTALL_GUARD.content).toContain(`"${GUARD_REFUSAL_TEXT} in namespace '"`);
    expect(GUARD_REFUSAL_TEXT.startsWith("ExecuteMCPv2.InstallGuard")).toBe(true);
  });

  it("reads the ownership signal under the name the bootstrap reads: the document of the embedded install guard", () => {
    expect(GUARD_DOCUMENT).toBe(IPM_INSTALL_GUARD.name);
    expect(ABSENT_DOCUMENT, "the control is another document").not.toBe(IPM_INSTALL_GUARD.name);
    expect(ABSENT_DOCUMENT.endsWith(".cls")).toBe(true);
  });
});

describe("manifestDeclarations and manifestProblems (IPM re-serializes a manifest on export)", () => {
  const declared = manifestDeclarations(realEmbed().moduleXml);

  it("reads the name, version, sources root, every resource with its preload flag and every invoke with its defaults", () => {
    expect(declared.name).toBe("iris-execute-mcp-v2");
    expect(declared.version).toBe(markerSemver(BOOTSTRAP_VERSION));
    expect(declared.sourcesRoot).toBe("ipm/src");
    expect(declared.resources).toHaveLength(36);
    expect(declared.resources[0]).toEqual({ name: "ExecuteMCPv2.InstallGuard.CLS", preload: true });
    expect(declared.invokes[0], "the guard's Check carries CheckStatus").toStrictEqual({ class: "ExecuteMCPv2.InstallGuard", method: "Check", phase: "Initialize", when: "After", checkStatus: true });
    expect(declared.invokes[1]).toEqual({ class: "ExecuteMCPv2.Setup", method: "Configure", phase: "Configure", when: "After" });
    expect(declared.invokes[1]?.checkStatus, "an invoke with no CheckStatus attribute").toBeUndefined();
  });

  it("ignores comments, attribute order, the default packaging and explicit defaults: the same declarations", () => {
    const reserialized = `<?xml version="1.0"?><Export><Document name="x"><Module>
      <Name>iris-execute-mcp-v2</Name><Version>${markerSemver(BOOTSTRAP_VERSION)}</Version><SourcesRoot>ipm/src</SourcesRoot>
      ${declared.resources.map((resource) => `<Resource ${resource.preload ? 'Preload="true" ' : 'Preload="false" '}Name="${resource.name}"></Resource>`).join("\n")}
      ${declared.invokes.map((entry) => `<Invoke ${entry.checkStatus === undefined ? "" : `CheckStatus="${entry.checkStatus ? 1 : 0}" `}When="${entry.when}" Phase="${entry.phase}" Method="${entry.method}" Class="${entry.class}"/>`).join("\n")}
    </Module></Document></Export>`;

    expect(manifestDeclarations(reserialized)).toEqual(declared);
    expect(manifestProblems(declared, manifestDeclarations(reserialized))).toEqual([]);
  });

  it.each([
    ["a missing resource", (m: typeof declared) => ({ ...m, resources: m.resources.slice(0, -1) }), /is declared but not in the archive/],
    ["an extra resource", (m: typeof declared) => ({ ...m, resources: [...m.resources, { name: "ExecuteMCPv2.Extra.CLS", preload: false }] }), /is in the archive's manifest but not declared/],
    ["a resource that lost its preload flag", (m: typeof declared) => ({ ...m, resources: m.resources.map((r, i) => (i === 0 ? { ...r, preload: false } : r)) }), /\(preload\) is declared but not/],
    ["swapped invokes", (m: typeof declared) => ({ ...m, invokes: [...m.invokes].reverse() }), /invokes:/],
    ["a dropped invoke", (m: typeof declared) => ({ ...m, invokes: m.invokes.slice(1) }), /invokes:/],
    ["another phase", (m: typeof declared) => ({ ...m, invokes: m.invokes.map((e, i) => (i === 0 ? { ...e, phase: "Reload" } : e)) }), /Initialize\/After/],
    ["a guard invoke that lost CheckStatus", (m: typeof declared) => ({ ...m, invokes: m.invokes.map((e, i) => (i === 0 ? { ...e, checkStatus: undefined } : e)) }), /Check Initialize\/After: the repository sets CheckStatus, the archive's manifest does not/],
    ["a guard invoke with CheckStatus off", (m: typeof declared) => ({ ...m, invokes: m.invokes.map((e, i) => (i === 0 ? { ...e, checkStatus: false } : e)) }), /the repository sets CheckStatus, the archive's manifest does not/],
    ["another version", (m: typeof declared) => ({ ...m, version: "9.9.9" }), /version:/],
    ["another name", (m: typeof declared) => ({ ...m, name: "other" }), /name:/],
  ])("reports %s", (_label, change, problem) => {
    expect(manifestProblems(declared, change(declared)).join(" ")).toMatch(problem);
  });

  it("reports a repository manifest that declares too little to compare: a comparison of nothing is not a pass", () => {
    const empty = manifestDeclarations("<Module></Module>");
    expect(manifestProblems(empty, empty).join(" ")).toMatch(/declares too little to compare/);
  });
});

describe("archiveProblems over a real tar czf of a staged module", () => {
  /** Stage the embed, make an archive with `mutate` applied to the staged tree, and return its members and the extracted tree. */
  function archiveOf(embed: Embed, mutate: (stage: string) => void = () => undefined) {
    const stage = scratchDir();
    const extracted = scratchDir();
    stageModule(stage, embed);
    mutate(stage);
    const archive = path.join(scratchDir(), "module.tgz");
    const made = tarGz(archive, stage);
    expect(made.status, made.stderr).toBe(0);
    const entries = readTgz(readFileSync(archive));
    extractEntries(entries, extracted);
    return { members: entries.map((entry) => entry.name), extracted };
  }

  it("finds nothing wrong with an archive of the embed", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed);

    expect(members.length).toBeGreaterThan(5);
    expect(archiveProblems(members, extracted, embed)).toEqual([]);
  });

  it("finds nothing wrong with the real embed's archive: 35 classes, the guard and module.xml", () => {
    const embed = realEmbed();
    const { members, extracted } = archiveOf(embed);

    expect(archiveProblems(members, extracted, embed)).toEqual([]);
  });

  it("reads a member name with a doubled slash as the single-slash name (IPM joins the sources root and cls that way)", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed);

    const doubled = members.map((member) => member.replace("ipm/src/cls/", "ipm/src//cls/"));
    expect(archiveProblems(doubled, extracted, embed)).toEqual([]);
  });

  it("tolerates line-end and trailing-whitespace differences, which an export may introduce", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed, (stage) => {
      const file = path.join(stage, "ipm/src/cls/ExecuteMCPv2/Utils.cls");
      writeFileSync(file, `${readFileSync(file, "utf8").replace(/\n/g, "\r\n")}\r\n\r\n`);
    });

    expect(archiveProblems(members, extracted, embed)).toEqual([]);
    expect(normalizeText("a\r\nb  \r\n\r\n")).toBe("a\nb");
  });

  it.each([
    ["a changed class", (stage: string) => writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Utils.cls"), "Class ExecuteMCPv2.Utils\n{\n// edited\n}\n"), /ipm\/src\/cls\/ExecuteMCPv2\/Utils\.cls differs from the embed/],
    ["a changed guard", (stage: string) => writeFileSync(path.join(stage, "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"), "Class ExecuteMCPv2.InstallGuard\n{\n}\n"), /InstallGuard\.cls differs from the embed/],
    ["a missing class", (stage: string) => rmSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls")), /carries 2 ipm\/src\/cls\/ class member\(s\), the embed 3|missing ipm\/src\/cls\/ExecuteMCPv2\/REST\/Dispatch\.cls/],
    ["a missing guard", (stage: string) => rmSync(path.join(stage, "preload"), { recursive: true }), /missing preload\/ipm\/src\/cls\/ExecuteMCPv2\/InstallGuard\.cls/],
    ["a missing manifest", (stage: string) => rmSync(path.join(stage, "module.xml")), /no module\.xml/],
    ["an extra class", (stage: string) => writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Extra.cls"), "Class ExecuteMCPv2.Extra\n{\n}\n"), /not an embedded class/],
    ["the classes under the old sources root, src/cls", (stage: string) => renameSync(path.join(stage, "ipm/src"), path.join(stage, "src")), /the archive is missing ipm\/src\/cls\/ExecuteMCPv2\/Utils\.cls/],
    ["a test class", (stage: string) => {
      mkdirSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Tests"), { recursive: true });
      writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Tests/UtilsTest.cls"), "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n");
    }, /test or fixture member ipm\/src\/cls\/ExecuteMCPv2\/Tests\/UtilsTest\.cls/],
    ["a fixture class", (stage: string) => writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/QAFixtures.cls"), "Class ExecuteMCPv2.QAFixtures\n{\n}\n"), /test or fixture member/],
  ])("reports %s", (_label, mutate, problem) => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed, mutate);

    expect(archiveProblems(members, extracted, embed).join(" ")).toMatch(problem);
  });

  it("reports a member that cannot be read from the extracted tree instead of passing it", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed);
    rmSync(path.join(extracted, "ipm/src/cls/ExecuteMCPv2/Setup.cls"));

    expect(archiveProblems(members, extracted, embed).join(" ")).toMatch(/Setup\.cls could not be read/);
  });
});

describe("session scripts and their markers", () => {
  it("writes a marker with the literal split, so the echo of the command never matches the marker it prints", () => {
    const statement = markerStatement("IPM", "tOK");

    expect(statement).toBe('Write "IRISMCP-"_"IPM-START:"_(tOK)_":IRISMCP-"_"IPM-END",!');
    expect(statement).not.toContain("IRISMCP-IPM-START");
    expect(markerValue(statement, "IPM"), "the echo of the typed command holds no marker").toBeUndefined();
    expect(() => markerStatement("lower", "x")).toThrow(/upper-case/);
  });

  it("reads a value back out of an output that echoes the typed command, including a multi-line value and a colon inside it", () => {
    const output = `USER>${markerStatement("COMMAND", "x")}\nIRISMCP-COMMAND-START:FAILED:ERROR #5001: line one\nline two: more:IRISMCP-COMMAND-END\nIRISMCP-REPOSITORIES-START:0:IRISMCP-REPOSITORIES-END\n`;

    expect(markerValue(output, "COMMAND")).toBe("FAILED:ERROR #5001: line one\nline two: more");
    expect(markerValue(output, "REPOSITORIES")).toBe("0");
    expect(markerValue(output, "OTHER")).toBeUndefined();
    expect(markerValue("IRISMCP-X-START:5:IRISMCP-X-END IRISMCP-X-START:6:IRISMCP-X-END", "X"), "the first complete marker wins").toBe("5");
  });

  it("makes scripts of one-line statements that end with Halt, and none contains a marker that its own echo would match", () => {
    const scripts = [
      importIpmScript(),
      repositoriesScript(),
      ipmCommandScript("load -dev /opt/iris-mcp/stage"),
      ipmCommandScript("package iris-execute-mcp-v2 -path /tmp/iris-mcp-ipm-out/iris-execute-mcp-v2"),
      ipmCommandScript("list"),
      outputDirectoryScript(),
      listOutputScript(),
      loadSyntheticSetupScript("/opt/iris-mcp/install/setup-newer.cls"),
      deleteSetupScript(),
      setupStateScript(),
      installChecksScript(),
      parityScript("/opt/iris-mcp/install/cases.json"),
    ];
    for (const script of scripts) {
      expect(script.endsWith("\nHalt\n"), script).toBe(true);
      expect(script).not.toMatch(/IRISMCP-[A-Z]+-START/);
      for (const line of script.trimEnd().split("\n")) expect(line.trim(), "no empty statement").not.toBe("");
    }
    expect(() => sessionScript(["Set a = 1\nSet b = 2"])).toThrow(/one line/);
  });

  it("builds the install checks of the matrix: compiled classes, test classes, version, application, mapping and an in-container GET", () => {
    const script = installChecksScript();

    for (const marker of ["COMPILED", "TESTCLASSES", "VERSION", "APP", "MAPPED", "HTTP", "GUARDDOC", "ABSENTDOC"]) expect(script, marker).toContain(`"${marker}-START:"`);
    expect(script).toContain("GetBootstrapVersion()");
    expect(script).toContain("/api/executemcp/v2/config/namespace");
    // The ownership signal, read through the Atelier route in the session's own namespace, with a document that does not exist as the control.
    expect(script).toContain('Get("/api/atelier/v1/"_$Namespace_"/doc/ExecuteMCPv2.InstallGuard.cls")');
    expect(script).toContain('Get("/api/atelier/v1/"_$Namespace_"/doc/ExecuteMCPv2.NoSuchGuard.cls")');
    expect(script.match(/%Net\.HttpRequest\)\.%New\(\)/g), "a request object of its own for the REST application and for Atelier").toHaveLength(2);
    expect(script).toContain("MatchRoles");
    expect(script).toContain("%STARTSWITH 'ExecuteMCPv2.'");
    expect(script).toContain("GeneratedBy");
  });

  it("builds the parity run over the guard's Classify, reading the cases from a JSON file", () => {
    const script = parityScript("/opt/iris-mcp/install/cases.json");

    expect(script).toContain('%FromJSONFile("/opt/iris-mcp/install/cases.json")');
    expect(script).toContain("ExecuteMCPv2.InstallGuard).Classify(tCase.deployed,tCase.embedded)");
  });

  it("builds a synthetic Setup with a marker, with the literal dev, and with no BOOTSTRAPVERSION", () => {
    expect(synthesizedSetup("1.2.3+4.aaaaaaaaaaaa")).toContain('Parameter BOOTSTRAPVERSION = "1.2.3+4.aaaaaaaaaaaa";');
    expect(synthesizedSetup("dev")).toContain('Parameter BOOTSTRAPVERSION = "dev";');
    expect(synthesizedSetup(null)).not.toContain("BOOTSTRAPVERSION");
    expect(synthesizedSetup(null)).toContain("Class ExecuteMCPv2.Setup Extends %RegisteredObject");
    expect(() => synthesizedSetup('a"b')).toThrow(/quote/);
    expect(() => synthesizedSetup("\u0661")).toThrow(/printable ASCII/);
  });

  it("derives the seed markers from the embedded one: newer by one sequence, older by one, dev, and none", () => {
    const seeds = seedMarkers("0.0.2+2.244fe8623c76", parseBootstrapMarker);

    expect(seeds).toEqual({ newer: "0.0.2+3.244fe8623c76", older: "0.0.2+1.244fe8623c76", dev: "dev", unknown: null });
    expect(classifyDeployedMarker(seeds.newer, "0.0.2+2.244fe8623c76")).toBe("newer");
    expect(classifyDeployedMarker(seeds.older, "0.0.2+2.244fe8623c76")).toBe("older");
    expect(seedMarkers("0.0.2+0.244fe8623c76", parseBootstrapMarker).older, "sequence 0: the patch is lowered").toBe("0.0.1+0.244fe8623c76");
    expect(() => seedMarkers("0.0.0+0.244fe8623c76", parseBootstrapMarker)).toThrow(/no older marker/);
    expect(() => seedMarkers("dev", parseBootstrapMarker)).toThrow(/not <semver>/);
  });

  it("reads the version `list` shows for the module through the terminal colour, and nothing for a module that is absent", () => {
    const listed = `\u001b[1mzpm\u001b[0m 0.10.5\r\n\u001b[32miris-execute-mcp-v2\u001b[0m 0.0.2\r\n`;

    expect(listedVersion(listed, "iris-execute-mcp-v2")).toBe("0.0.2");
    expect(listedVersion(listed, "zpm")).toBe("0.10.5");
    expect(listedVersion("zpm 0.10.5\n[USER|iris-execute-mcp-v2] Initialize START\n", "iris-execute-mcp-v2")).toBeUndefined();
    expect(listedVersion("", "iris-execute-mcp-v2")).toBeUndefined();
    expect(stripTerminal("\u001b[1mx\u001b[0m\r")).toBe("x");
  });

  it("reads the archive names out of the FILES marker: only .tgz files count", () => {
    expect(archiveNames("a.tgz|b.txt|")).toEqual(["a.tgz"]);
    expect(archiveNames("a.tgz|b.tgz|")).toEqual(["a.tgz", "b.tgz"]);
    expect(archiveNames(undefined)).toEqual([]);
    expect(archiveNames("")).toEqual([]);
  });
});

describe("parityProblems", () => {
  const cases = JSON.parse(readFileSync(PARITY_FIXTURE, "utf8")) as ParityCase[];
  const answers = cases.map((entry) => classifyDeployedMarker(entry.deployed, entry.embedded));

  it("finds nothing when InstallGuard.Classify answers what the comparator answers for every case", () => {
    expect(parityProblems(cases, answers, classifyDeployedMarker)).toEqual([]);
  });

  it("names every case on which the two disagree, with the case's note and both answers", () => {
    const wrong = answers.map((answer, index) => (index === 3 || index === 11 ? (answer === "older" ? "newer" : "older") : answer));

    const problems = parityProblems(cases, wrong, classifyDeployedMarker);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("case 3");
    expect(problems[0]).toContain(cases[3]?.note);
    expect(problems[0]).toContain("InstallGuard.Classify says");
    expect(problems[0]).toContain("classifyDeployedMarker says");
  });

  it("reports a result list of another length as one problem, and an empty case list as a failure rather than a pass", () => {
    expect(parityProblems(cases, answers.slice(1), classifyDeployedMarker)).toHaveLength(1);
    expect(parityProblems([], [], classifyDeployedMarker).join(" ")).toMatch(/no parity cases/);
  });

  it("holds the table's own expectations to the comparator too", () => {
    const lying = cases.map((entry, index) => (index === 0 ? { ...entry, expected: "foreign" } : entry));

    expect(parityProblems(lying, answers, classifyDeployedMarker).join(" ")).toMatch(/the table expects "foreign"/);
  });
});

// -- the served archive (Story 42.8, DW-694; decision #122) -----------------------------------

describe("moduleMemberSet and servedArchiveUrl", () => {
  it("lists module.xml first, then the tracked files under ipm/src and preload, once each, and nothing else a whole repository holds", () => {
    const listing = ["ipm/src/cls/ExecuteMCPv2/Utils.cls", "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls", "ipm/src/cls/ExecuteMCPv2/Utils.cls", "", "ipm/preload/ExecuteMCPv2/InstallGuard.cls", "README.md", "preloaded.txt"].join("\n");

    expect(moduleMemberSet(listing)).toEqual(["module.xml", "ipm/src/cls/ExecuteMCPv2/Utils.cls", "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"]);
    expect(moduleMemberSet("")).toEqual(["module.xml"]);
  });

  it("builds the address codeload.github.com serves a commit at: owner/repo and the full sha", () => {
    expect(servedArchiveUrl(SERVED_REPOSITORY, SERVED_SHA)).toBe(`https://codeload.github.com/jbrandtmse/iris-execute-mcp-v2/tar.gz/${SERVED_SHA}`);
  });
});

describe("registryArchiveProblems over a real `tar czf` of a whole repository that holds the real IPM tree (DW-694)", () => {
  /**
   * Write the repository, apply `mutate`, tar it the way the registry does and judge its members against the module's members, which
   * are listed before the mutation (what `git ls-files` says of the commit) or after it (`listAfter`).
   */
  function judged(mutate: (repo: string) => void = () => undefined, extraTarArguments: string[] = ["--exclude=.git"], listAfter = false): string[] {
    const repo = scratchDir();
    const listed = writeServedRepository(repo);
    mutate(repo);
    const members = moduleMemberSet((listAfter ? filesUnder(repo).filter((file) => file.startsWith("ipm/src/") || file.startsWith("preload/")) : listed).join("\n"));
    const archive = path.join(scratchDir(), "registry-root.tgz");
    const made = tarGz(archive, repo, extraTarArguments);
    expect(made.status, made.stderr).toBe(0);
    return registryArchiveProblems(readTgz(readFileSync(archive)), members);
  }

  it("finds nothing wrong with the real tree inside a whole repository: ./module.xml at the top, every module member, the guard under preload/", () => {
    expect(judged()).toEqual([]);
    const repo = scratchDir();
    writeServedRepository(repo);
    const archive = path.join(scratchDir(), "registry-root.tgz");
    expect(tarGz(archive, repo, ["--exclude=.git"]).status).toBe(0);
    expect(readTgz(readFileSync(archive)).some((entry) => entry.name === "./module.xml"), "the members are ./<path>, as the registry's tar writes them").toBe(true);
  });

  it("does not judge the rest of the repository: other files, a docs folder and a symbolic link are not problems", () => {
    expect(
      judged((repo) => {
        writeFileSync(path.join(repo, "docs", "more.md"), "more\n");
        symlinkSync("README.md", path.join(repo, "link.md"));
      }),
    ).toEqual([]);
  });

  it("module.xml under a subdirectory is refused: there is no module.xml at the top", () => {
    const problems = judged((repo) => {
      mkdirSync(path.join(repo, "sub"));
      renameSync(path.join(repo, "module.xml"), path.join(repo, "sub", "module.xml"));
    });
    expect(problems.join("\n")).toMatch(/no module\.xml at its top/);
    expect(problems.join("\n")).toMatch(/missing the module member module\.xml/);
  });

  it.each([false, true])("the stamped guard moved out of preload/ is refused, whether the listing was taken before or after the move (listAfter %s)", (listAfter) => {
    const problems = judged((repo) => {
      renameSync(path.join(repo, "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"), path.join(repo, "ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"));
      rmSync(path.join(repo, "preload"), { recursive: true });
    }, ["--exclude=.git"], listAfter);
    expect(problems.join("\n")).toMatch(/missing the module member preload\/ipm\/src\/cls\/ExecuteMCPv2\/InstallGuard\.cls/);
  });

  it("a class the module lists but the archive lacks is refused, naming it", () => {
    const problems = judged((repo) => rmSync(path.join(repo, "ipm/src/cls/ExecuteMCPv2/Utils.cls")));
    expect(problems).toEqual(["the archive is missing the module member ipm/src/cls/ExecuteMCPv2/Utils.cls. Commit it, or restore it from git (pnpm gen:ipm -- --force only from a clean version commit)."]);
  });

  it("a preload/ file other than the guard is refused, naming it, even when the repository's listing does not list it", () => {
    const problems = judged((repo) => writeFileSync(path.join(repo, "preload", "other.txt"), "x\n"));
    expect(problems.join("\n")).toMatch(/holds preload\/other\.txt, where nothing but the stamped guard may live/);
  });

  it("a requirements.txt at the top is refused: IPM would run pip install -r on it", () => {
    const problems = judged((repo) => writeFileSync(path.join(repo, "requirements.txt"), "left-pad\n"));
    expect(problems.join("\n")).toMatch(/holds requirements\.txt at its top: IPM runs pip install -r/);
  });

  it("a requirements.txt below the top is not a problem: only the root one is read", () => {
    expect(judged((repo) => writeFileSync(path.join(repo, "docs", "requirements.txt"), "x\n"))).toEqual([]);
  });

  it("a .git directory that tar did not exclude is refused, and with --exclude=.git it never reaches the archive", () => {
    const addGit = (repo: string) => {
      mkdirSync(path.join(repo, ".git"));
      writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    };
    expect(judged(addGit, []).join("\n")).toMatch(/holds \.\/\.git\/HEAD, which the registry's tar excludes/);
    expect(judged(addGit)).toEqual([]);
  });

  it("the member names are compared without the leading ./ and doubled slashes, and an empty archive is refused rather than passed", () => {
    const guard = "./preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls";
    expect(registryArchiveProblems([{ name: ".//module.xml", type: "file" }, { name: guard, type: "file" }, { name: "./", type: "directory" }], ["module.xml"])).toEqual([]);
    expect(registryArchiveProblems([], ["module.xml"]).join("\n")).toMatch(/no module\.xml at its top/);
  });
});

describe("stripArchivePrefix and archiveEqualityProblems over a real GitHub-shaped archive and a real git-shaped archive (DW-694)", () => {
  /** The repository's members as `git archive` writes them, and as GitHub's archive of the same commit wraps them. */
  function bothArchives(mutateGithub: (repo: string) => void = () => undefined) {
    const repo = scratchDir();
    writeServedRepository(repo);
    const local = path.join(scratchDir(), "local.tgz");
    gitArchiveOf(repo, local);
    mutateGithub(repo);
    const github = path.join(scratchDir(), "github.tgz");
    githubArchiveOf(repo, github, scratchDir());
    return { local: readTgz(readFileSync(local)), github: readTgz(readFileSync(github)) };
  }
  const LABELS = { actual: "GitHub's archive", expected: "git archive HEAD" };

  it("removes the <repo>-<sha>/ folder and the folder member itself, leaving the repository's own members", () => {
    const { github } = bothArchives();
    expect(github.some((entry) => entry.name.replace(/^\.\//, "").startsWith(`${SERVED_PREFIX}/`))).toBe(true);

    const stripped = stripArchivePrefix(github);

    expect(stripped.map((entry) => entry.name.replace(/^\.\//, "")).some((name) => name.startsWith(SERVED_PREFIX))).toBe(false);
    expect(stripped.map((entry) => entry.name)).toContain("module.xml");
    expect(stripped.filter((entry) => entry.type === "file").map((entry) => entry.name)).toContain("preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls");
    expect(stripped.map((entry) => entry.name)).not.toContain("");
  });

  it("finds GitHub's archive equal to git archive when the files are the same, whatever directory members either side holds", () => {
    const { local, github } = bothArchives();
    expect(local.some((entry) => entry.type === "directory"), "git's archive here holds file members only, GitHub's holds folders too").toBe(false);
    expect(github.some((entry) => entry.type === "directory")).toBe(true);

    expect(archiveEqualityProblems(stripArchivePrefix(github), local, LABELS)).toEqual([]);
  });

  it("reports a file that differs by one byte, a file GitHub's archive lacks and a file it holds that git archive does not, each naming the file", () => {
    const { local, github } = bothArchives((repo) => {
      writeFileSync(path.join(repo, "README.md"), "# A stand-in repository README!\n");
      rmSync(path.join(repo, "docs", "notes.md"));
      writeFileSync(path.join(repo, "docs", "extra.md"), "extra\n");
    });

    expect(archiveEqualityProblems(stripArchivePrefix(github), local, LABELS)).toEqual([
      "README.md differs between GitHub's archive and git archive HEAD.",
      "GitHub's archive is missing docs/notes.md, which git archive HEAD holds.",
      "GitHub's archive holds docs/extra.md, which git archive HEAD does not.",
    ]);
  });

  it("compares a link member by name: a link on one side only is reported", () => {
    const link = (name: string) => ({ name, type: "other", data: Buffer.alloc(0) });
    const file = { name: "a.txt", type: "file", data: Buffer.from("a") };

    expect(archiveEqualityProblems([file, link("l")], [file, link("l")], LABELS)).toEqual([]);
    expect(archiveEqualityProblems([file], [file, link("l")], LABELS)).toEqual(["GitHub's archive is missing the link l, which git archive HEAD holds."]);
    expect(archiveEqualityProblems([file, link("l")], [file], LABELS)).toEqual(["GitHub's archive holds the link l, which git archive HEAD does not."]);
  });

  it("refuses an archive whose members do not share one folder, a lone top-level file and an empty archive", () => {
    const file = (name: string) => ({ name, type: "file", data: Buffer.from("x") });
    expect(() => stripArchivePrefix([file("one/a.txt"), file("two/b.txt")])).toThrow(/do not share one top-level folder \(one, two\)/);
    expect(() => stripArchivePrefix([file("a.txt")])).toThrow(/is not a folder/);
    expect(() => stripArchivePrefix([])).toThrow(/no members/);
  });
});

describe("treeExpectations reads what the served leg installs from the committed tree, never from the embed (DW-694)", () => {
  /** A scratch repository holding the real tree, restamped as another version: marker 9.9.9+7.aaaaaaaaaaaa, one resource fewer. */
  function otherTree(): string {
    const repo = scratchDir();
    writeServedRepository(repo);
    const guardFile = path.join(repo, "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls");
    writeFileSync(guardFile, readFileSync(guardFile, "utf8").replace(/Parameter BOOTSTRAPVERSION = "[^"]*";/, 'Parameter BOOTSTRAPVERSION = "9.9.9+7.aaaaaaaaaaaa";'));
    const manifest = readFileSync(path.join(repo, "module.xml"), "utf8");
    writeFileSync(path.join(repo, "module.xml"), manifest.replace(/<Version>[^<]*<\/Version>/, "<Version>9.9.9</Version>").replace(/ *<Resource Name="ExecuteMCPv2\.REST\.Coverage\.CLS"\/>\n/, ""));
    return repo;
  }

  it("answers the tree's marker, version, module name and resource count: a tree that moved apart from the embed gives its own values", () => {
    const wants = treeExpectations(otherTree());
    // The committed tree is frozen between releases and moves at the version step, so its resource count is read, never written down.
    const committedResources = manifestDeclarations(readFileSync(path.join(REPO_ROOT, "module.xml"), "utf8")).resources.length;

    expect(committedResources, "the committed module.xml's resources were read").toBeGreaterThan(1);
    expect(wants).toEqual({ marker: "9.9.9+7.aaaaaaaaaaaa", semver: "9.9.9", moduleName: "iris-execute-mcp-v2", classCount: committedResources - 1 });
    expect(wants.marker, "not the embed's").not.toBe(BOOTSTRAP_VERSION);
  });

  it("answers the real tree's own values at the checked-in tree", () => {
    const wants = treeExpectations(REPO_ROOT);

    expect(wants.marker).toMatch(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/);
    expect(wants.moduleName).toBe("iris-execute-mcp-v2");
    expect(wants.marker.split("+")[0]).toBe(wants.semver);
  });

  it("refuses a repository with no module.xml and one with no stamped guard, naming the command", () => {
    const empty = scratchDir();
    expect(() => treeExpectations(empty)).toThrow(/module\.xml is missing from the repository root: run pnpm gen:ipm/);
    const noGuard = otherTree();
    rmSync(path.join(noGuard, "preload"), { recursive: true });
    expect(() => treeExpectations(noGuard)).toThrow(/stamped install guard under preload\/ is missing/);
  });
});

describe("the session script of the registry-shaped leg", () => {
  it("runs GNU tar from inside the mounted root into the output directory, excluding .git, and reads back OUTDIR, TAR and FILES", () => {
    expect(registryTarCommand()).toBe("tar --exclude=.git -czf /tmp/iris-mcp-ipm-out/registry-root.tgz -C /opt/iris-mcp/registry/root .");
    const script = registryArchiveScript();
    expect(script).toContain(`$ZF(-1,"${registryTarCommand()}")`);
    for (const name of ["OUTDIR", "TAR", "FILES"]) expect(markerValue(`IRISMCP-${name}-START:x:IRISMCP-${name}-END`, name), name).toBe("x");
    expect(script).toContain('IRISMCP-"_"TAR-START:');
    expect(script.endsWith("Halt\n")).toBe(true);
    expect(ipmVerbsOf(script), "it issues no IPM verb").toEqual([]);
  });
});

// -- the verb set (AC 42.4.4) ----------------------------------------------------------------

describe("the IPM verbs the proof issues (AC 42.4.4)", () => {
  it("are load, package and list, and none of the verbs that reach a registry or enable one", () => {
    expect([...IPM_VERBS].sort()).toEqual(["list", "load", "package"]);
    expect([...FORBIDDEN_IPM_VERBS].sort()).toEqual(["enable", "install", "publish", "repo", "update"]);
    for (const forbidden of FORBIDDEN_IPM_VERBS) expect(IPM_VERBS).not.toContain(forbidden);
  });

  it("refuses to build a script for any other verb, or for a command with a quote or a line break", () => {
    for (const verb of [...FORBIDDEN_IPM_VERBS, "uninstall", "search", "version", ""]) {
      expect(() => ipmCommandScript(`${verb} x`), verb).toThrow(/refusing the IPM verb/);
    }
    expect(() => ipmCommandScript('load "x"')).toThrow(/no double quote/);
    expect(() => ipmCommandScript("load x\nHalt")).toThrow(/no double quote or line break/);
  });

  it("reads the verb of every Shell call of a script, and an unreadable one as the empty verb", () => {
    expect(ipmVerbsOf(ipmCommandScript("load -dev /opt/iris-mcp/stage"))).toEqual(["load"]);
    expect(ipmVerbsOf('Set tSC = ##class(%IPM.Main).Shell("repo -r -n registry",0,0)')).toEqual(["repo"]);
    expect(ipmVerbsOf('Set tSC = ##class(%IPM.Main).Shell("",0,0)')).toEqual([""]);
    expect(ipmVerbsOf(importIpmScript())).toEqual([]);
  });

  it("are the only verbs in the source text of the script and of its helpers: every Shell call names one of IPM_VERBS", () => {
    const verbs = new Set<string>();
    for (const file of ["scripts/ci-ipm-archive.mjs", "scripts/lib/ipm-archive.mjs"]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      // A Shell call whose command is a template placeholder (or the `...` of a comment) is not a verb; an empty one is a failure.
      expect(ipmVerbsOf(source), `${file}: no Shell call with an empty command`).not.toContain("");
      for (const verb of ipmVerbsOf(source).filter((candidate) => /^[a-z]/.test(candidate))) verbs.add(verb);
      // The verbs also appear as `ipm(container, "<command>")` calls and in command strings.
      for (const match of source.matchAll(/ipm\(container, [`'"]([a-z-]+)[ `'"]/g)) verbs.add(match[1] as string);
      for (const forbidden of FORBIDDEN_IPM_VERBS) {
        expect(source, `${file}: ipm(container, "${forbidden} ...")`).not.toMatch(new RegExp(`ipm\\(container, [\`'"]${forbidden}[ \`'"]`));
        expect(source, `${file}: Shell("${forbidden} ...")`).not.toMatch(new RegExp(`Shell\\("${forbidden}[ "]`));
      }
    }
    for (const verb of verbs) expect(IPM_VERBS, verb).toContain(verb);
    expect([...verbs].sort(), "and every verb is used").toEqual([...IPM_VERBS].sort());
  });

  it("imports no child_process in the script or its archive helpers: the archive is read in-process, so no tar or gzip binary is needed on any host (docker is spawned by the harness alone)", () => {
    for (const file of ["scripts/ci-ipm-archive.mjs", "scripts/lib/ipm-archive.mjs"]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(source, file).not.toMatch(/child_process|\bspawn(?:Sync)?\(/);
    }
  });

  it("the served-archive leg spawns one thing, a read-only git, and refuses every other git verb", async () => {
    const { defaultServedDeps } = await import("../../../../scripts/lib/served-archive.mjs");
    const source = readFileSync(path.join(REPO_ROOT, "scripts/lib/served-archive.mjs"), "utf8");

    expect([...GIT_VERBS].sort()).toEqual(["archive", "ls-files"]);
    expect(source.match(/spawnSync\(/g), "one spawn in the module").toHaveLength(1);
    expect(source).toContain("spawnSync('git', args");
    const deps = defaultServedDeps({ env: { PATH: process.env.PATH }, cwd: REPO_ROOT });
    for (const verb of ["push", "commit", "tag", "fetch", "pull", "checkout", "reset", "clean", "config"]) {
      expect(() => deps.git([verb]), verb).toThrow(/refusing the git verb/);
    }
    // The real shape of the answer (Rule #54): a spawnSync result with a Buffer on stdout.
    const listed = deps.git(["ls-files", "ipm/src", "preload"]);
    expect(listed.status, listed.stderr).toBe(0);
    expect(Buffer.isBuffer(listed.stdout)).toBe(true);
  });

  it("publishes, uploads and reads no secret: the script and its helpers hold none of those words as a statement", () => {
    for (const file of ["scripts/ci-ipm-archive.mjs", "scripts/lib/ipm-archive.mjs", "scripts/lib/served-archive.mjs", "scripts/lib/ipm-tree.mjs"]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(source, file).not.toMatch(/npm publish|pnpm publish|changeset (version|publish)|git tag|secrets\.|upload-artifact|vsce publish|ovsx publish|npm login/);
      // No docker argument is built here: the containers belong to the harness.
      expect(source, file).not.toMatch(/['"`]docker['"`]/);
      expect(source, file).not.toMatch(/\b(?:execSync|execFileSync|execFile)\(/);
    }
  });
});

// -- the scripted run ------------------------------------------------------------------------

describe("the command line", () => {
  it("runs both editions by default, and one with --edition", () => {
    expect(parseArgs([])).toEqual({ editions: ["community", "health"] });
    expect(parseArgs(["--edition", "health"])).toEqual({ editions: ["health"] });
    expect(parseArgs(["--edition", "community"])).toEqual({ editions: ["community"] });
    expect(Object.keys(EDITIONS)).toEqual(["community", "health"]);
    expect(EDITIONS.community.namespace).toBe("USER");
    expect(EDITIONS.health.namespace).toBe("HSCUSTOM");
  });

  it.each([["--edition"], ["--edition", "both"], ["--edition", "health", "--edition", "community"], ["health"], ["--bad"]])("refuses %j with exit code 2", (...argv) => {
    expect(() => parseArgs(argv)).toThrow(PhaseFailure);
    try {
      parseArgs(argv);
    } catch (error) {
      expect((error as PhaseFailure).code).toBe(2);
    }
  });
});

/**
 * The CommonJS module the scripted docker loads to answer every `iris session` that is not the readiness loop: it plays IPM and IRIS for the
 * phases of the proof. State lives in files under the docker stand-in's directory, because every call is a new process. The fault to inject
 * is in `handler-config.json` (`fail`), and `table` maps `deployed|embedded` to what the comparator answers.
 */
const SESSION_HANDLER = String.raw`
const fs = require("node:fs");
const path = require("node:path");

module.exports = function handler(namespace, stdin, { dir, container }) {
  const config = JSON.parse(fs.readFileSync(path.join(dir, "handler-config.json"), "utf8"));
  const statePath = path.join(dir, "handler-" + container.id + ".json");
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { setup: null, installed: false, guardDefined: false };
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
  const fail = config.fail;
  const mountHost = (container.mount || "").split(":")[0];
  // The served leg installs what the committed tree stamps, which config may set apart from the embed's marker and version.
  const served = path.basename(mountHost) === "registry";
  const wantMarker = served && config.registryMarker ? config.registryMarker : config.marker;
  const wantSemver = served && config.registrySemver ? config.registrySemver : config.semver;
  const marker = (name, value) => "IRISMCP-" + name + "-START:" + value + ":IRISMCP-" + name + "-END\n";
  const repositories = (after) => marker("REPOSITORIES", fail === "repositories-after-" + after ? "1" : "0");
  const log = (line) => fs.appendFileSync(path.join(dir, "handler.log"), line + "\n");
  if (config.signalOn && stdin.includes(config.signalOn)) process.kill(process.ppid, "SIGTERM");
  let out = "";

  if (stdin.includes("OBJ.Load(\"/usr/irissys/dist/install/misc/zpm.xml\"")) {
    out += marker("IPM", fail === "import" ? "FAILED:ERROR #5001: scripted" : "OK") + repositories("import");
  } else if (stdin.includes("Shell(\"load -dev ")) {
    out += (fail === "load-dev" ? "" : "") + marker("COMMAND", fail === "load-dev" ? "FAILED:ERROR #5001: scripted load -dev failure" : "OK") + repositories("load-dev");
  } else if (stdin.includes("$ZF(-1,")) {
    // The registry-shaped leg: GNU tar of the extracted served archive, made inside the container (the command text is what the test pins).
    out += marker("OUTDIR", fail === "registry-outdir-fails" ? "0" : "1") + marker("TAR", fail === "registry-tar-fails" ? "2" : "0") + marker("FILES", fail === "registry-no-archive" ? "" : "registry-root.tgz|");
  } else if (stdin.includes("RemoveDirectoryTree")) {
    out += marker("OUTDIR", fail === "outdir-fails" ? "0" : "1");
  } else if (stdin.includes("Shell(\"package ")) {
    out += marker("COMMAND", fail === "package" ? "FAILED:ERROR #5001: scripted package failure" : "OK") + repositories("package");
  } else if (stdin.includes("%File:FileSet")) {
    const files = fail === "no-archive" ? "" : fail === "two-archives" ? "a.tgz|b.tgz|" : "iris-execute-mcp-v2.tgz|";
    out += marker("FILES", files);
  } else if (stdin.includes("OBJ.Load(\"/opt/iris-mcp/install/setup-")) {
    const leg = /setup-([a-z]+)\.cls/.exec(stdin)[1];
    const source = fs.readFileSync(path.join(mountHost, "setup-" + leg + ".cls"), "utf8");
    const found = /Parameter BOOTSTRAPVERSION = "([^"]*)";/.exec(source);
    state.setup = found ? found[1] : "";
    save();
    const synthFails = fail === "synth-fails" || (fail === "older-synth-fails" && leg === "older");
    out += marker("SYNTH", synthFails ? "FAILED:ERROR #5001: scripted synthetic load failure" : "OK");
  } else if (stdin.includes("Shell(\"load /opt/iris-mcp/install/") || stdin.includes("Shell(\"load /tmp/iris-mcp-ipm-out/registry-root.tgz")) {
    let outcome = "OK";
    if (state.setup !== null) {
      const relation = state.setup === "" ? "unknown" : config.relations[state.setup];
      const refuses = relation === "newer" || relation === "foreign" || relation === "unknown";
      const accepts = fail === "guard-accepts-" + relation || fail === "guard-accepts-all";
      if (refuses && !accepts) {
        const own = fail === "guard-wrong-text" ? "" : "ExecuteMCPv2.InstallGuard refused the install in namespace '" + namespace + "': ";
        const deployed = fail === "guard-no-deployed-marker" ? "?" : state.setup;
        outcome = "FAILED:ERROR #5001: " + own + "the deployed ExecuteMCPv2.Setup marker \"" + deployed + "\" cannot be installed over " + (fail === "guard-no-own-marker" ? "" : "this package's marker \"" + config.marker + "\"") + ", and nothing was installed.";
      } else if (fail === "older-load-fails" && relation === "older") {
        outcome = "FAILED:ERROR #5001: scripted load failure over an older Setup";
      }
    } else if (fail === "fresh-load-fails") {
      outcome = "FAILED:ERROR #5001: scripted load failure on a fresh namespace";
    }
    if (outcome === "OK") {
      state.installed = true;
      state.guardDefined = true;
      state.setup = fail === "version-wrong" ? wantMarker + "x" : wantMarker;
    } else if (fail === "guard-setup-changed") {
      state.setup = wantMarker;
    } else if (fail === "guard-leaves-guard") {
      state.guardDefined = true;
    } else if (fail === "guard-leaves-module") {
      state.installed = true;
    }
    save();
    out += marker("COMMAND", outcome) + repositories("load");
    if (state.installed) out += "iris-execute-mcp-v2 " + wantSemver + "\n";
  } else if (stdin.includes("Shell(\"list\"")) {
    const listed = fail === "list-version-wrong" ? "0.0.0" : wantSemver;
    out += (state.installed ? "\u001b[32miris-execute-mcp-v2\u001b[0m " + listed + "\r\n" : "zpm 0.10.5\r\n") + marker("COMMAND", "OK") + repositories("list");
  } else if (stdin.includes("OBJ.Delete(\"ExecuteMCPv2.Setup\"")) {
    state.setup = fail === "setup-not-deleted" || fail === "delete-fails" ? state.setup : null;
    save();
    out += marker("DELETE", fail === "delete-fails" ? "FAILED:ERROR #5001: scripted delete failure" : "OK");
  } else if (stdin.includes("Set tDefined = ")) {
    const setup = state.setup === null ? "absent" : "compiled:" + state.setup;
    out += marker("SETUP", fail === "health-not-fresh" && namespace === "HSCUSTOM" && !state.installed ? "compiled:1.0.0+1.cccccccccccc" : setup) + marker("GUARD", state.guardDefined ? "1" : "0");
  } else if (stdin.includes("%Dictionary.CompiledClass WHERE Name %STARTSWITH")) {
    const app = fail === "app-matchroles" ? namespace + "|ExecuteMCPv2.REST.Dispatch|1|%All" : namespace + "|ExecuteMCPv2.REST.Dispatch|1|";
    out += marker("COMPILED", fail === "compiled-count" || (fail === "registry-compiled-count" && path.basename(mountHost) === "registry") ? "35" : "36") + marker("TESTCLASSES", fail === "test-classes" ? "2" : "0");
    const version = fail === "version-call-wrong" ? "not-the-marker" : state.setup === null ? "" : state.setup;
    out += marker("VERSION", version) + marker("APP", app) + marker("MAPPED", fail === "not-mapped" ? "0" : "1") + marker("HTTP", fail === "http-500" ? "500" : "200");
    out += marker("GUARDDOC", fail === "guard-document-missing" ? "404" : fail === "guard-document-unauthorized" ? "401" : "200") + marker("ABSENTDOC", fail === "absent-document-found" ? "200" : "404");
  } else if (stdin.includes("%FromJSONFile")) {
    const cases = JSON.parse(fs.readFileSync(path.join(mountHost, "cases.json"), "utf8"));
    const results = cases.map((entry, index) => {
      const answer = config.table[entry.deployed + "|" + entry.embedded];
      const wrong = (fail === "parity-mismatch" && index === 5) || (fail === "parity-many-mismatch" && index >= 5);
      return wrong ? (answer === "older" ? "newer" : "older") : answer;
    });
    out += marker("PARITY", fail === "parity-short" ? results.slice(1).join(",") + "," : results.join(",") + ",");
  } else {
    log("unscripted session in " + namespace + ": " + stdin);
    return { stdout: "unscripted session\n", status: 7 };
  }
  log(namespace + " " + (stdin.split("\n")[0] || "").slice(0, 80));
  return { stdout: out, status: 0 };
};
`;

describe.skipIf(process.platform === "win32")("scripts/ci-ipm-archive.mjs as a process against a scripted docker", () => {
  // The script loads the BUILT shared dist, so a missing or stale dist fails these cases here, naming the rebuild, instead of failing each one on
  // a marker the dist and the sources disagree about.
  beforeAll(() => {
    const stale = staleDistReason(REPO_ROOT, "shared");
    if (stale !== undefined) throw new Error(`The scripted run loads the built shared dist (pnpm --filter @iris-mcp/shared build): ${stale}`);
  });

  let root = "";
  let fake: FakeDocker;
  let tmp = "";
  let archiveSource = "";
  let registryArchiveSource = "";
  let fetchPreload = "";
  let servedCount = 0;
  const LS_FILES = () => path.join(root, "ls-files.txt");
  const LOCAL_ARCHIVE = () => path.join(root, "git-archive.tgz");
  const GITHUB_ARCHIVE = () => path.join(root, "github-archive.tgz");
  let embed: Embed;
  let cases: ParityCase[];

  /**
   * Write the served leg's inputs: a repository holding the real IPM tree and files the module does not need, then the three archives
   * made from copies of it, each of which `variant` may change on its own: what `git archive HEAD` writes (`local`), what GitHub's
   * archive of the commit holds (`github`) and what the container's GNU re-tar writes (`registry`). `listing` changes what
   * `git ls-files ipm/src preload` prints.
   */
  function buildServed(variant: { local?: (repo: string) => void; github?: (repo: string) => void; registry?: (repo: string) => void; listing?: (members: string[]) => string[] } = {}): void {
    servedCount += 1;
    const base = path.join(root, `served-${servedCount}`);
    const repo = path.join(base, "repo");
    mkdirSync(repo, { recursive: true });
    const members = writeServedRepository(repo);
    const copy = (name: string, mutate: ((repo: string) => void) | undefined): string => {
      const directory = path.join(base, name);
      cpSync(repo, directory, { recursive: true });
      mutate?.(directory);
      return directory;
    };
    gitArchiveOf(copy("local", variant.local), LOCAL_ARCHIVE());
    githubArchiveOf(copy("github", variant.github), GITHUB_ARCHIVE(), path.join(base, "wrapper"));
    const reTarred = tarGz(registryArchiveSource, copy("registry", variant.registry), ["--exclude=.git"]);
    expect(reTarred.status, reTarred.stderr).toBe(0);
    writeFileSync(LS_FILES(), `${(variant.listing?.(members) ?? members).join("\n")}\n`);
  }

  /** The environment of a GitHub Actions run of the commit, with the fetch stand-in loaded. */
  const ciEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: SERVED_REPOSITORY,
    GITHUB_SHA: SERVED_SHA,
    NODE_OPTIONS: fetchPreload,
    ...extra,
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ci-ipm-archive-run-"));
    scratch.push(root);
    fake = installFakeDocker(root);
    tmp = path.join(root, "tmp");
    mkdirSync(tmp);
    embed = realEmbed();

    // The archive the scripted `cp` hands out: a real tar of the staged embed, as the build container's package would leave.
    const stage = path.join(root, "archive-stage");
    mkdirSync(stage);
    stageModule(stage, embed);
    archiveSource = path.join(root, "good.tgz");
    const made = tarGz(archiveSource, stage);
    expect(made.status, made.stderr).toBe(0);

    // The served leg's world: a whole repository holding the real tree, the stand-in `git` that lists and archives it, GitHub's archive of
    // the same commit for the fetch stand-in, and the archive the scripted `cp` copies out of the container after its GNU re-tar.
    installFakeGit(fake.binDir);
    fetchPreload = writeFetchPreload(root);
    registryArchiveSource = path.join(root, "registry-good.tgz");
    servedCount = 0;
    buildServed();

    // What the comparator answers for every case the run will send: the fixture's and the three built from the embedded marker.
    const fixture = JSON.parse(readFileSync(PARITY_FIXTURE, "utf8")) as ParityCase[];
    const seeds = seedMarkers(embed.marker, parseBootstrapMarker);
    cases = [
      ...fixture,
      { note: "r1", deployed: embed.marker, embedded: embed.marker, expected: "" },
      { note: "r2", deployed: seeds.older, embedded: embed.marker, expected: "" },
      { note: "r3", deployed: seeds.newer, embedded: embed.marker, expected: "" },
    ];
    const table: Record<string, string> = {};
    for (const entry of cases) table[`${entry.deployed}|${entry.embedded}`] = classifyDeployedMarker(entry.deployed, entry.embedded);
    const relations: Record<string, string> = {};
    for (const marker of [seeds.newer, seeds.older, "dev"]) relations[marker] = classifyDeployedMarker(marker, embed.marker);
    writeFileSync(path.join(root, "handler.cjs"), SESSION_HANDLER, "utf8");
    writeConfig({ table, relations });
  });

  /** (Re)write the handler's configuration, adding `extra` to the fixed part. */
  function writeConfig(extra: Record<string, unknown>): void {
    const file = path.join(fake.dir, "handler-config.json");
    const current = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    writeFileSync(
      file,
      JSON.stringify({ marker: embed.marker, semver: markerSemver(embed.marker), ...current, ...extra }),
      "utf8",
    );
  }

  interface Run {
    status: number | null;
    stdout: string;
    stderr: string;
    /** The PATH the script ran with. */
    path: string;
  }

  /**
   * Run the script as a process whose PATH is the scripted docker's directory alone and whose temp directory is `tmp`. No `tar` and no
   * `gzip` resolves on that PATH on any host, so a spawn of either by the script fails here as it would on a runner without them.
   */
  function runScript(args: string[], env: Record<string, string> = {}, afterStart?: () => void): Promise<Run> {
    const childEnv: Record<string, string> = {
      PATH: fake.binDir,
      TMPDIR: tmp,
      FAKE_DOCKER_DIR: fake.dir,
      FAKE_DOCKER_SESSION_HANDLER: path.join(root, "handler.cjs"),
      FAKE_DOCKER_CP_SOURCE: archiveSource,
      FAKE_DOCKER_CP_REGISTRY_SOURCE: registryArchiveSource,
      FAKE_GIT_DIR: fake.dir,
      FAKE_GIT_LS_FILES: LS_FILES(),
      FAKE_GIT_ARCHIVE: LOCAL_ARCHIVE(),
      FAKE_FETCH_FILE: GITHUB_ARCHIVE(),
      ...env,
    };
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.once("error", reject);
      child.once("close", (status) => resolve({ status, stdout, stderr, path: childEnv.PATH as string }));
      afterStart?.();
    });
  }

  const dockerVerbs = (): string[] => fake.calls().map((call) => call.argv[0] as string);
  /** The stdin of every session that is not the readiness loop. */
  const sessionScripts = (): string[] => fake.calls().filter((call) => call.argv[0] === "exec" && !call.argv.includes("%SYS")).map((call) => call.stdin);
  const leftoverTempDirectories = (): string[] => readdirSync(tmp).filter((entry) => entry.startsWith("iris-mcp-ipm-"));

  /** Whatever happened, no container is left, none was started with a port, and the temporary directory is gone. */
  function expectCleanEnd(): void {
    expect(fake.containers(), "every container is removed").toEqual({});
    expect(leftoverTempDirectories(), "the temporary directory is removed").toEqual([]);
    for (const call of fake.calls().filter((candidate) => candidate.argv[0] === "run")) {
      expect(call.argv, "every container runs with no network").toContain("--network");
      expect(call.argv[call.argv.indexOf("--network") + 1]).toBe("none");
      expect(call.argv, "and publishes no port").not.toContain("-p");
      expect(call.argv.some((argument) => argument.endsWith(":ro")), "and mounts read-only").toBe(true);
    }
  }

  it("passes a full run: one archive built on a no-network community container, installed on community and health, every container removed", async () => {
    const run = await runScript([]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("[preflight]");
    expect(run.stderr).toContain("[build] built iris-execute-mcp-v2.tgz");
    expect(run.stderr).toMatch(/\[archive\] \d+ members: module\.xml, 35 classes equal to the embed, the preloaded guard/);
    for (const leg of ["guard-newer", "guard-dev", "guard-unknown"]) expect(run.stderr, leg).toContain(`[${leg}] the guard refused the load`);
    expect(run.stderr).toContain("[install-community] the archive installed over an older Setup");
    expect(run.stderr).toContain("[install-health] the archive installed on a fresh");
    expect(run.stderr).toMatch(/\[parity-community\] \d+\/\d+ cases agree/);
    expect(run.stderr).toMatch(/\[parity-health\] \d+\/\d+ cases agree/);
    // The served leg (DW-694): the archive of the repository, extracted, re-tarred in a fresh container per edition, copied out once and
    // checked, then loaded as an archive. A local run has no GITHUB_ACTIONS, so `git archive HEAD` stands in and says so.
    expect(run.stderr).toContain("[served] local emulation of GitHub's archive (CI fetches the real one)");
    const memberCount = realTreeMembers().length;
    expect(run.stderr).toContain(`[served] git archive HEAD (local emulation): ${filesUnder(path.join(root, "served-1", "local")).length} files, module members present (${memberCount}: module.xml, ipm/src, preload;`);
    expect(run.stderr).toContain(`[registry-community] the archive re-tarred as the registry serves it holds ./module.xml at its top, no .git and the ${memberCount} module members`);
    expect(run.stderr).toContain("[registry-community] the registry-shaped archive installed on a fresh");
    expect(run.stderr).toContain("[registry-health] the registry-shaped archive installed on a fresh");
    expect(run.stderr).toMatch(/\[parity-registry-community\] \d+\/\d+ cases agree/);
    expect(run.stderr).toMatch(/\[parity-registry-health\] \d+\/\d+ cases agree/);
    expect(run.stderr).toContain("PASS: one archive of iris-execute-mcp-v2");
    expect(run.stderr).toContain("0 package-registry rows");
    expect(run.stderr).toContain("the local git archive of HEAD, re-tarred as the registry serves it, installed iris-execute-mcp-v2");
    expect(fakeFetchCalls(fake.dir), "a local run fetches nothing").toEqual([]);
    expect(fakeGitCalls(fake.dir)).toEqual([["ls-files", "ipm/src", "preload"], ["archive", "--format=tar.gz", "HEAD"]]);

    const runs = fake.calls().filter((call) => call.argv[0] === "run");
    expect(runs, "a build container, one install container and one registry-shaped container per edition").toHaveLength(5);
    expect(runs.map((call) => call.argv[call.argv.length - 1])).toEqual([
      EDITIONS.community.image,
      EDITIONS.community.image,
      EDITIONS.health.image,
      EDITIONS.community.image,
      EDITIONS.health.image,
    ]);
    expect(dockerVerbs().filter((verb) => verb === "rm")).toHaveLength(5);
    expect(dockerVerbs().filter((verb) => verb === "cp"), "the built archive, and the registry-shaped one (community only)").toHaveLength(2);
    expect(dockerVerbs().filter((verb) => verb === "logs"), "no log is read when everything passes").toHaveLength(0);
    expectCleanEnd();
  }, 120_000);

  it("reads the archive in-process: the run passes on a PATH that holds the scripted docker alone, where neither tar nor gzip resolves", async () => {
    const run = await runScript(["--edition", "community"]);

    expect(findExecutable("tar", run.path), `no tar on the script's PATH (${run.path})`).toBeUndefined();
    expect(findExecutable("gzip", run.path), `no gzip on the script's PATH (${run.path})`).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toMatch(/\[archive\] \d+ members: module\.xml, 35 classes equal to the embed/);
    expect(run.stderr).not.toMatch(/\b(?:tar|gzip)\b/);
    expectCleanEnd();
  }, 120_000);

  it("issues exactly the verbs load, package and list in the sessions of a full run, and no other", async () => {
    const run = await runScript([]);
    expect(run.status, run.stderr).toBe(0);

    const verbs = new Set(sessionScripts().flatMap((script) => ipmVerbsOf(script)));
    expect([...verbs].sort(), "both directions: every allowed verb is used, and nothing else").toEqual([...IPM_VERBS].sort());
    for (const forbidden of FORBIDDEN_IPM_VERBS) {
      expect(sessionScripts().some((script) => new RegExp(`Shell\\("${forbidden}[ "]`).test(script)), forbidden).toBe(false);
    }
    expect(sessionScripts().length).toBeGreaterThan(30);
  }, 120_000);

  it.each([
    ["community", ["build", "install-community", "registry-community"], 3],
    ["health", ["build", "install-health", "registry-health"], 3],
  ])("--edition %s starts the build container, that edition's install container and its registry-shaped container only", async (edition, phases, containers) => {
    const run = await runScript(["--edition", edition]);

    expect(run.status, run.stderr).toBe(0);
    expect(fake.calls().filter((call) => call.argv[0] === "run")).toHaveLength(containers);
    for (const phase of phases) expect(run.stderr).toContain(`[${phase}]`);
    expect(run.stderr).not.toContain(edition === "community" ? "[install-health]" : "[install-community]");
    expect(run.stderr).not.toContain(edition === "community" ? "[registry-health]" : "[registry-community]");
    expectCleanEnd();
  }, 120_000);

  /** Each fault the handler can inject, the phase and edition the run must name, and a fragment of the reason. */
  const FAULTS: Array<[string, string, string, string, string]> = [
    // fault, edition arg, phase, edition label, reason
    ["import", "community", "build", "community", "IPM did not import on build"],
    ["repositories-after-import", "community", "build", "community", "holds 1 row(s) after the IPM import"],
    ["load-dev", "community", "build", "community", "load -dev of the staged module did not succeed"],
    ["repositories-after-load-dev", "community", "build", "community", "holds 1 row(s) after `load`"],
    ["package", "community", "build", "community", "the package verb did not complete"],
    ["repositories-after-package", "community", "build", "community", "holds 1 row(s) after `package`"],
    ["no-archive", "community", "build", "community", "holds 0 archive(s)"],
    ["two-archives", "community", "build", "community", "holds 2 archive(s)"],
    ["guard-accepts-newer", "community", "guard-newer", "community", "succeeded or printed no outcome"],
    ["guard-wrong-text", "community", "guard-newer", "community", "not with the install guard's text"],
    ["guard-no-own-marker", "community", "guard-newer", "community", "does not name this package's marker"],
    ["guard-setup-changed", "community", "guard-newer", "community", "Setup changed from"],
    ["guard-leaves-guard", "community", "guard-newer", "community", "install guard class is still defined"],
    ["guard-leaves-module", "community", "guard-newer", "community", "list shows iris-execute-mcp-v2 after a refused install"],
    ["setup-not-deleted", "community", "guard-newer", "community", "Setup is still defined"],
    ["guard-accepts-foreign", "community", "guard-dev", "community", "succeeded or printed no outcome"],
    ["guard-accepts-unknown", "community", "guard-unknown", "community", "succeeded or printed no outcome"],
    ["repositories-after-load", "community", "guard-newer", "community", "holds 1 row(s) after `load`"],
    ["version-wrong", "community", "install-community", "community", "after the upgrade, not compiled:"],
    ["compiled-count", "community", "install-community", "community", "35 ExecuteMCPv2 classes are compiled and up to date, not 36"],
    ["test-classes", "community", "install-community", "community", "2 compiled class(es) are test or fixture classes"],
    ["app-matchroles", "community", "install-community", "community", "reads"],
    ["not-mapped", "community", "install-community", "community", "does not map the ExecuteMCPv2 package"],
    ["http-500", "community", "install-community", "community", 'answered "500", not 200'],
    ["parity-mismatch", "community", "parity-community", "community", "InstallGuard.Classify says"],
    ["parity-short", "community", "parity-community", "community", "answered"],
    ["health-not-fresh", "health", "install-health", "health", "already has a Setup class"],
    // The registry-shaped leg (DW-694): each clause of its checks can fail on its own.
    ["registry-outdir-fails", "community", "registry-community", "community", "could not be emptied and created"],
    ["registry-tar-fails", "community", "registry-community", "community", "tar exited \"2\" making the registry-shaped archive"],
    ["registry-no-archive", "community", "registry-community", "community", "not the one registry-root.tgz"],
    ["fresh-load-fails", "community", "registry-community", "community", "load of the registry-shaped archive did not succeed"],
    ["registry-compiled-count", "community", "registry-community", "community", "35 ExecuteMCPv2 classes are compiled and up to date, not 36"],
    ["registry-tar-fails", "health", "registry-health", "health", "tar exited"],
    ["fresh-load-fails", "health", "install-health", "health", "load of the archive on a fresh container did not succeed"],
    ["parity-mismatch", "health", "parity-health", "health", "InstallGuard.Classify says"],
    ["http-500", "health", "install-health", "health", 'answered "500", not 200'],
    // The ownership signal the server's bootstrap reads: the install guard's document answers 200 through Atelier, a missing one 404.
    ["guard-document-missing", "community", "install-community", "community", 'of ExecuteMCPv2.InstallGuard.cls in USER from inside the container answered "404", not 200'],
    ["guard-document-unauthorized", "community", "install-community", "community", 'answered "401", not 200'],
    ["absent-document-found", "community", "install-community", "community", 'of ExecuteMCPv2.NoSuchGuard.cls answered "200", not 404'],
    ["guard-document-missing", "health", "install-health", "health", 'of ExecuteMCPv2.InstallGuard.cls in HSCUSTOM from inside the container answered "404", not 200'],
    ["absent-document-found", "health", "install-health", "health", 'of ExecuteMCPv2.NoSuchGuard.cls answered "200", not 404'],
    // Each of these is the only thing wrong in its run, so each clause of the script's checks is shown to be able to fail.
    ["outdir-fails", "community", "build", "community", "could not be emptied and created"],
    ["synth-fails", "community", "guard-newer", "community", "synthetic Setup could not be loaded"],
    ["delete-fails", "community", "guard-newer", "community", "synthetic Setup could not be deleted"],
    ["guard-no-deployed-marker", "community", "guard-newer", "community", "does not name the deployed marker"],
    ["older-synth-fails", "community", "install-community", "community", "older synthetic Setup could not be loaded"],
    ["older-load-fails", "community", "install-community", "community", "over an older Setup"],
    ["list-version-wrong", "community", "install-community", "community", "list names iris-execute-mcp-v2 at"],
    ["version-call-wrong", "community", "install-community", "community", "GetBootstrapVersion() answers"],
    ["list-version-wrong", "health", "install-health", "health", "list names iris-execute-mcp-v2 at"],
    ["version-wrong", "health", "install-health", "health", "GetBootstrapVersion() answers"],
  ];

  it.each(FAULTS)(
    "the %s fault in a %s run ends with exit 1 naming the %s phase and the %s edition, with every container removed",
    async (fault, editionArg, phase, editionLabel, reason) => {
      writeConfig({ fail: fault });

      const run = await runScript(["--edition", editionArg]);

      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain(`FAILED in the ${phase} phase (${editionLabel})`);
      expect(run.stderr).toContain(reason);
      expect(run.stderr).not.toContain("PASS:");
      expect(dockerVerbs(), "the failing container's log is printed before it is removed").toContain("logs");
      expect(dockerVerbs().indexOf("logs")).toBeLessThan(dockerVerbs().lastIndexOf("rm"));
      expectCleanEnd();
    },
    120_000,
  );

  describe("an archive that differs from the embed ends the run in the archive phase", () => {
    function archiveWith(mutate: (stage: string) => void): void {
      const stage = path.join(root, "bad-stage");
      mkdirSync(stage);
      stageModule(stage, embed);
      mutate(stage);
      const bad = path.join(root, "bad.tgz");
      const made = tarGz(bad, stage);
      expect(made.status, made.stderr).toBe(0);
      archiveSource = bad;
    }

    it.each([
      ["a class that differs from the embed", (stage: string) => writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Utils.cls"), "Class ExecuteMCPv2.Utils\n{\n// edited after the embed\n}\n"), "differs from the embed"],
      ["a missing class", (stage: string) => rmSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls")), "the archive is missing ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls"],
      ["a test class", (stage: string) => {
        mkdirSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Tests"), { recursive: true });
        writeFileSync(path.join(stage, "ipm/src/cls/ExecuteMCPv2/Tests/UtilsTest.cls"), "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n");
      }, "test or fixture member"],
      ["a manifest at another version", (stage: string) => writeFileSync(path.join(stage, "module.xml"), readFileSync(path.join(stage, "module.xml"), "utf8").replace(/<Version>[^<]*<\/Version>/, "<Version>9.9.9</Version>")), "version:"],
      ["a manifest that lost its invokes", (stage: string) => writeFileSync(path.join(stage, "module.xml"), readFileSync(path.join(stage, "module.xml"), "utf8").replace(/<Invoke [^>]*>/g, "")), "invokes:"],
      ["a manifest whose guard invoke lost CheckStatus", (stage: string) => writeFileSync(path.join(stage, "module.xml"), readFileSync(path.join(stage, "module.xml"), "utf8").replace(' CheckStatus="true"', "")), "the repository sets CheckStatus, the archive's manifest does not"],
    ])("%s", async (_label, mutate, reason) => {
      archiveWith(mutate);

      const run = await runScript(["--edition", "community"]);

      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain("FAILED in the archive phase");
      expect(run.stderr).toContain(reason);
      expect(run.stderr, "no install container was started").not.toContain("[install-community]");
      expect(fake.calls().filter((call) => call.argv[0] === "run")).toHaveLength(1);
      expectCleanEnd();
    }, 120_000);
  });

  describe("the served leg: the archive the registry downloads for the commit under test (DW-694; decision #122)", () => {
    const GUARD_MEMBER = "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls";
    const notServed = (what: string) => `GitHub did not serve the archive of ${SERVED_SHA} (${what}). The gate proves the archive the registry downloads; it never falls back to a local emulation in CI.`;

    it("in CI it fetches GitHub's archive of GITHUB_SHA from the codeload address, requires it equal to git archive, and installs it re-tarred on both editions", async () => {
      const run = await runScript([], ciEnv());

      expect(run.status, run.stderr).toBe(0);
      expect(fakeFetchCalls(fake.dir), "one fetch, of the address built from GITHUB_REPOSITORY and GITHUB_SHA").toEqual([`https://codeload.github.com/${SERVED_REPOSITORY}/tar.gz/${SERVED_SHA}`]);
      expect(run.stderr).toContain(`[served] GitHub's archive of ${SERVED_SHA}: ${filesUnder(path.join(root, "served-1", "local")).length} files, equal to git archive HEAD, module members present (${realTreeMembers().length}: module.xml, ipm/src, preload;`);
      expect(run.stderr).not.toContain("[served] local emulation");
      expect(run.stderr).toContain("[registry-community] the registry-shaped archive installed on a fresh");
      expect(run.stderr).toContain("[registry-health] the registry-shaped archive installed on a fresh");
      expect(run.stderr).toContain(`GitHub's archive of the commit, re-tarred as the registry serves it, installed iris-execute-mcp-v2 ${treeExpectations(REPO_ROOT).semver} (${treeExpectations(REPO_ROOT).marker}) on community and health too`);
      expect(fakeGitCalls(fake.dir), "git only lists the module's files and archives HEAD").toEqual([["ls-files", "ipm/src", "preload"], ["archive", "--format=tar.gz", "HEAD"]]);
      expectCleanEnd();
    }, 120_000);

    it("expects the install to carry what the committed tree stamps: the preflight names the tree's marker, and the leg's checks read it", async () => {
      const run = await runScript(["--edition", "community"]);
      const wants = treeExpectations(REPO_ROOT);

      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr).toContain(`the committed tree stamps ${wants.marker} (module.xml ${wants.moduleName} ${wants.semver}, ${wants.classCount} classes)`);
      expect(run.stderr).toContain(`[registry-community] list: ${wants.moduleName} ${wants.semver}; ${wants.classCount} classes compiled (none a test or fixture); marker ${wants.marker};`);
    }, 120_000);

    describe("a tree that stands apart from the embed (between releases the embed moves and the tree stays at the last released content)", () => {
      /**
       * A scratch repository whose committed tree was generated at shared version 9.9.9, so it stamps 9.9.9+<n>.<hash> while the built dist
       * still holds the embed's marker; the stand-in git lists and archives that tree. Returns the repository root and the tree's marker.
       */
      function divergedRepository(): { repoRoot: string; treeMarker: string } {
        const repoRoot = path.join(root, "diverged-repo");
        mkdirSync(repoRoot, { recursive: true });
        copyGeneratorInputs(repoRoot, REPO_ROOT);
        const sharedManifest = path.join(repoRoot, "packages", "shared", "package.json");
        writeFileSync(sharedManifest, JSON.stringify({ ...(JSON.parse(readFileSync(sharedManifest, "utf8")) as object), version: "9.9.9" }));
        const generated = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "gen-bootstrap.mjs"), "--ipm"], { cwd: repoRoot, encoding: "utf8" });
        expect(generated.status, generated.stderr).toBe(0);
        mkdirSync(path.join(repoRoot, "packages", "shared", "src", "__tests__", "fixtures"), { recursive: true });
        cpSync(PARITY_FIXTURE, path.join(repoRoot, "packages", "shared", "src", "__tests__", "fixtures", "bootstrap-marker-parity-cases.json"));
        symlinkSync(path.join(REPO_ROOT, "packages", "shared", "dist"), path.join(repoRoot, "packages", "shared", "dist"));

        // What the stand-in git lists and archives, and what the container's re-tar writes: the scratch tree plus a README.
        const served = path.join(root, "diverged-served");
        mkdirSync(served, { recursive: true });
        for (const entry of ["module.xml", "ipm/src", "preload"]) {
          mkdirSync(path.dirname(path.join(served, entry)), { recursive: true });
          cpSync(path.join(repoRoot, entry), path.join(served, entry), { recursive: true });
        }
        writeFileSync(path.join(served, "README.md"), "# stand-in\n");
        writeFileSync(LS_FILES(), `${filesUnder(served).filter((file) => file.startsWith("ipm/src/") || file.startsWith("preload/")).join("\n")}\n`);
        gitArchiveOf(served, LOCAL_ARCHIVE());
        expect(tarGz(registryArchiveSource, served, ["--exclude=.git"]).status).toBe(0);
        const treeMarker = ipmTreeMarker(repoRoot) as string;
        expect(treeMarker.startsWith("9.9.9+")).toBe(true);
        expect(treeMarker, "the tree and the embed disagree").not.toBe(embed.marker);
        return { repoRoot, treeMarker };
      }

      const inProcessEnv = (): Record<string, string> => ({
        PATH: fake.binDir,
        TMPDIR: tmp,
        FAKE_DOCKER_DIR: fake.dir,
        FAKE_DOCKER_SESSION_HANDLER: path.join(root, "handler.cjs"),
        FAKE_DOCKER_CP_SOURCE: archiveSource,
        FAKE_DOCKER_CP_REGISTRY_SOURCE: registryArchiveSource,
        FAKE_GIT_DIR: fake.dir,
        FAKE_GIT_LS_FILES: LS_FILES(),
        FAKE_GIT_ARCHIVE: LOCAL_ARCHIVE(),
      });

      it("installs it and judges the install as the tree: the version, the class count and the marker it stamps, which the embed does not", async () => {
        const { repoRoot, treeMarker } = divergedRepository();
        writeConfig({ registryMarker: treeMarker, registrySemver: "9.9.9" });
        const lines: string[] = [];

        const code = await runIpmArchive({ repoRoot, editions: ["community"], env: inProcessEnv(), log: (line: string) => lines.push(line), tmpRoot: tmp });

        const log = lines.join("\n");
        expect(code, log).toBe(0);
        expect(log).toContain(`[preflight] the embed ${embed.marker} is stamped; the committed tree stamps ${treeMarker} (module.xml iris-execute-mcp-v2 9.9.9, 36 classes)`);
        expect(log).toContain(`[registry-community] list: iris-execute-mcp-v2 9.9.9; 36 classes compiled (none a test or fixture); marker ${treeMarker};`);
        expect(log, "the build and install legs still prove the embed").toContain(`[install-community] list: iris-execute-mcp-v2 ${markerSemver(embed.marker)}; 36 classes compiled (none a test or fixture); marker ${embed.marker};`);
        expect(log).toContain(`installed iris-execute-mcp-v2 9.9.9 (${treeMarker}) on community too`);
      }, 120_000);

      it("fails when the served install carries the embed's version instead of the tree's, naming both", async () => {
        const { repoRoot } = divergedRepository();
        const lines: string[] = [];

        const code = await runIpmArchive({ repoRoot, editions: ["community"], env: inProcessEnv(), log: (line: string) => lines.push(line), tmpRoot: tmp });

        expect(code, lines.join("\n")).toBe(1);
        expect(lines.join("\n")).toContain(`FAILED in the registry-community phase (community): list names iris-execute-mcp-v2 at "${markerSemver(embed.marker)}", not 9.9.9.`);
      }, 120_000);
    });

    /** The environment of an in-process CI run: the scripted docker and git, and the variables that name the commit. */
    const inProcessCiEnv = (): Record<string, string> => ({
      PATH: fake.binDir,
      TMPDIR: tmp,
      FAKE_DOCKER_DIR: fake.dir,
      FAKE_DOCKER_SESSION_HANDLER: path.join(root, "handler.cjs"),
      FAKE_DOCKER_CP_SOURCE: archiveSource,
      FAKE_DOCKER_CP_REGISTRY_SOURCE: registryArchiveSource,
      FAKE_GIT_DIR: fake.dir,
      FAKE_GIT_LS_FILES: LS_FILES(),
      FAKE_GIT_ARCHIVE: LOCAL_ARCHIVE(),
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: SERVED_REPOSITORY,
      GITHUB_SHA: SERVED_SHA,
    });

    /**
     * An in-process CI run whose GET answers from `answers` (a status, or "network" for a rejected fetch; the last answer repeats) and
     * whose waits are zero and recorded. The git is the scripted one the PATH holds.
     */
    async function ciRunWithAnswers(answers: Array<number | "network">): Promise<{ code: number; log: string; urls: string[]; waits: number[] }> {
      const env = inProcessCiEnv();
      const urls: string[] = [];
      const waits: number[] = [];
      const served = {
        ...defaultServedDeps({ env, cwd: REPO_ROOT }),
        fetch: async (url: string): Promise<Response> => {
          urls.push(url);
          const answer = answers[Math.min(urls.length - 1, answers.length - 1)];
          if (answer === "network") throw new TypeError("fetch failed");
          if (answer !== 200) return new Response("not served", { status: answer });
          return new Response(readFileSync(GITHUB_ARCHIVE()), { status: 200 });
        },
        sleep: async (ms: number): Promise<void> => {
          waits.push(ms);
        },
        retryDelaysMs: [0, 0],
      };
      const lines: string[] = [];
      const code = await runIpmArchive({ editions: ["community"], env, served, log: (line: string) => lines.push(line), tmpRoot: tmp });
      return { code, log: lines.join("\n"), urls, waits };
    }

    it("the real fetch waits 2 s, then 5 s, between its three attempts", async () => {
      const { FETCH_RETRY_DELAYS_MS } = await import("../../../../scripts/lib/served-archive.mjs");
      expect([...FETCH_RETRY_DELAYS_MS]).toEqual([2000, 5000]);
      expect([...defaultServedDeps({ env: { PATH: process.env.PATH }, cwd: REPO_ROOT }).retryDelaysMs]).toEqual([2000, 5000]);
    });

    it("a 503 and then a 200 from GitHub passes the leg: the GET is made twice, with one wait between", async () => {
      const run = await ciRunWithAnswers([503, 200]);

      expect(run.code, run.log).toBe(0);
      expect(run.urls, "two attempts, both at the codeload address").toEqual(Array(2).fill(`https://codeload.github.com/${SERVED_REPOSITORY}/tar.gz/${SERVED_SHA}`));
      expect(run.waits).toEqual([0]);
      expect(run.log).toContain(`[served] GitHub's archive of ${SERVED_SHA}:`);
      expect(run.log).toContain("[registry-community] the registry-shaped archive installed on a fresh");
    }, 120_000);

    it.each([
      ["a 404", [404], "404"],
      ["a 503", [503], "503"],
      ["a fetch that cannot connect", ["network"], "fetch failed"],
      ["a 503, a 404 and then a 502", [503, 404, 502], "502"],
    ] as Array<[string, Array<number | "network">, string]>)("%s from GitHub on all three attempts fails the leg with exit 1, naming the sha and the last status, and never falls back to git archive", async (_label, answers, shown) => {
      const run = await ciRunWithAnswers(answers);

      expect(run.code, run.log).toBe(1);
      expect(run.urls, "three attempts in all").toHaveLength(3);
      expect(run.waits, "two waits, between the attempts").toEqual([0, 0]);
      expect(run.log).toContain("FAILED in the served phase");
      expect(run.log).toContain(notServed(shown));
      expect(run.log).toContain(`Fetched https://codeload.github.com/${SERVED_REPOSITORY}/tar.gz/${SERVED_SHA}`);
      expect(run.log, "no local emulation stands in for the real archive").not.toContain("[served] local emulation");
      expect(run.log).not.toContain("git archive HEAD (local emulation)");
      expect(run.log).not.toContain("PASS:");
      expect(run.log, "no served container ran").not.toContain("[registry-community]");
      expect(fake.calls().filter((call) => call.argv[0] === "run"), "the build and the one install container only").toHaveLength(2);
      expectCleanEnd();
    }, 120_000);

    it("a GitHub archive that is not an archive, or has no wrapping folder, fails the leg naming what is wrong", async () => {
      writeFileSync(GITHUB_ARCHIVE(), "this is not an archive");
      const unreadable = await runScript(["--edition", "community"], ciEnv());
      expect(unreadable.status, unreadable.stderr).toBe(1);
      expect(unreadable.stderr).toContain(`GitHub's archive of ${SERVED_SHA} could not be read: the archive is not a gzip file`);

      buildServed();
      cpSync(LOCAL_ARCHIVE(), GITHUB_ARCHIVE());
      const unwrapped = await runScript(["--edition", "community"], ciEnv());
      expect(unwrapped.status, unwrapped.stderr).toBe(1);
      expect(unwrapped.stderr).toMatch(/could not be read: the archive's members do not share one top-level folder/);
    }, 120_000);

    it.each([
      ["a file that differs by one byte", { github: (repo: string) => writeFileSync(path.join(repo, "README.md"), "# A stand-in repository README!\n") }, "README.md differs between GitHub's archive of"],
      ["a file GitHub's archive lacks", { github: (repo: string) => rmSync(path.join(repo, "docs", "notes.md")) }, "is missing docs/notes.md, which git archive HEAD holds"],
      ["a file GitHub's archive holds that git archive does not", { github: (repo: string) => writeFileSync(path.join(repo, "docs", "extra.md"), "extra\n") }, "holds docs/extra.md, which git archive HEAD does not"],
      ["a module file that differs", { github: (repo: string) => writeFileSync(path.join(repo, "ipm/src/cls/ExecuteMCPv2/Utils.cls"), "Class ExecuteMCPv2.Utils\n{\n}\n") }, "ipm/src/cls/ExecuteMCPv2/Utils.cls differs between GitHub's archive of"],
    ])("%s between GitHub's archive and git archive ends the leg with exit 1, naming the member (is HEAD the commit under test?)", async (_label, variant, reason) => {
      buildServed(variant);

      const run = await runScript(["--edition", "community"], ciEnv());

      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain("FAILED in the served phase");
      expect(run.stderr).toContain(reason);
      expect(run.stderr).toContain("is not git archive HEAD (is HEAD the commit under test?)");
      expect(run.stderr).not.toContain("[registry-community]");
      expectCleanEnd();
    }, 120_000);

    const BOTH = (mutate: (repo: string) => void) => ({ local: mutate, github: mutate });
    it.each([
      ["a module member the archive lacks (export-ignored, or never committed)", BOTH((repo) => rmSync(path.join(repo, "ipm/src/cls/ExecuteMCPv2/Utils.cls"))), undefined, "missing the module member ipm/src/cls/ExecuteMCPv2/Utils.cls"],
      ["the stamped guard missing from preload/", BOTH((repo) => rmSync(path.join(repo, "preload"), { recursive: true })), undefined, `missing the module member ${GUARD_MEMBER}`],
      [
        "the stamped guard moved out of preload/, with a listing that follows it (the mutation the install legs must also catch)",
        BOTH((repo) => {
          renameSync(path.join(repo, GUARD_MEMBER), path.join(repo, "ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"));
          rmSync(path.join(repo, "preload"), { recursive: true });
        }),
        (members: string[]) => [...members.filter((member) => !member.startsWith("preload/")), "ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"],
        `missing the module member ${GUARD_MEMBER}`,
      ],
      ["module.xml at another path than the top", BOTH((repo) => renameSync(path.join(repo, "module.xml"), path.join(repo, "docs", "module.xml"))), undefined, "no module.xml at its top"],
      ["a file other than the guard under preload/", BOTH((repo) => writeFileSync(path.join(repo, "preload", "other.txt"), "x\n")), undefined, "holds preload/other.txt, where nothing but the stamped guard may live"],
      ["a requirements.txt at the root", BOTH((repo) => writeFileSync(path.join(repo, "requirements.txt"), "left-pad\n")), undefined, "holds requirements.txt at its top"],
    ])("%s ends the leg with exit 1 in the served phase, naming the member", async (_label, variant, listing, reason) => {
      buildServed({ ...variant, ...(listing === undefined ? {} : { listing }) });

      const run = await runScript(["--edition", "community"], ciEnv());

      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain("FAILED in the served phase");
      expect(run.stderr).toContain("the archive the registry would download is not an installable module");
      expect(run.stderr).toContain(reason);
      expect(run.stderr, "the install legs of the served archive never ran").not.toContain("[registry-community]");
      expectCleanEnd();
    }, 120_000);

    it("a git that cannot list or archive the commit is a refusal with exit 2, naming the verb", async () => {
      const run = await runScript(["--edition", "community"], { FAKE_GIT_FAIL: "128" });

      expect(run.status, run.stderr).toBe(2);
      expect(run.stderr).toContain("FAILED in the served phase");
      expect(run.stderr).toContain("git ls-files failed (fatal: scripted failure)");
      expect(fakeGitCalls(fake.dir)).toEqual([["ls-files", "ipm/src", "preload"]]);
      expectCleanEnd();
    }, 120_000);

    it.each([
      ["GITHUB_SHA", { GITHUB_SHA: "" }],
      ["GITHUB_REPOSITORY", { GITHUB_REPOSITORY: "" }],
    ])("a CI run with no %s cannot name the commit: exit 2, and nothing is fetched", async (_name, missing) => {
      const run = await runScript(["--edition", "community"], ciEnv(missing));

      expect(run.status, run.stderr).toBe(2);
      expect(run.stderr).toContain("GITHUB_ACTIONS is set but GITHUB_SHA or GITHUB_REPOSITORY is not");
      expect(fakeFetchCalls(fake.dir)).toEqual([]);
      expectCleanEnd();
    }, 120_000);

    it("a local run, with no GITHUB_ACTIONS, fetches nothing even when a fetch stand-in is loaded, and says it is a local emulation", async () => {
      const run = await runScript(["--edition", "health"], { NODE_OPTIONS: fetchPreload, FAKE_FETCH_STATUS: "404" });

      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr).toContain("[served] local emulation of GitHub's archive (CI fetches the real one)");
      expect(fakeFetchCalls(fake.dir)).toEqual([]);
    }, 120_000);

    describe("what the container's GNU re-tar wrote", () => {
      /** The re-tar the scripted `cp` copies out is judged against the module's members before the archive is loaded. */
      it.each([
        ["module.xml under a subdirectory", { registry: (repo: string) => renameSync(path.join(repo, "module.xml"), path.join(repo, "docs", "module.xml")) }, "no module.xml at its top"],
        ["the guard missing", { registry: (repo: string) => rmSync(path.join(repo, "preload"), { recursive: true }) }, `missing the module member ${GUARD_MEMBER}`],
        ["a requirements.txt at the top", { registry: (repo: string) => writeFileSync(path.join(repo, "requirements.txt"), "x\n") }, "holds requirements.txt at its top"],
      ])("%s ends the run in the registry phase", async (_label, variant, reason) => {
        buildServed(variant);

        const run = await runScript(["--edition", "community"]);

        expect(run.status, run.stderr).toBe(1);
        expect(run.stderr).toContain("FAILED in the registry-community phase (community)");
        expect(run.stderr).toContain("the registry-shaped archive does not hold the module");
        expect(run.stderr).toContain(reason);
        expect(run.stderr, "the install of the built archive passed before it").toContain("[install-community] the archive installed over an older Setup");
        expect(run.stderr, "nothing was loaded from the bad archive").not.toContain("[registry-community] the registry-shaped archive installed");
        expectCleanEnd();
      }, 120_000);

      it("a .git directory that the re-tar did not exclude is refused", async () => {
        const base = path.join(root, "git-not-excluded");
        mkdirSync(path.join(base, ".git"), { recursive: true });
        writeFileSync(path.join(base, ".git", "HEAD"), "x\n");
        const repo = path.join(base, "repo");
        mkdirSync(repo);
        writeServedRepository(repo);
        cpSync(path.join(base, ".git"), path.join(repo, ".git"), { recursive: true });
        expect(tarGz(registryArchiveSource, repo, ["--exclude=nothing"]).status).toBe(0);

        const run = await runScript(["--edition", "community"]);

        expect(run.status, run.stderr).toBe(1);
        expect(run.stderr).toContain("FAILED in the registry-community phase (community)");
        expect(run.stderr).toContain("which the registry's tar excludes");
        expectCleanEnd();
      }, 120_000);

      it("an archive that cannot be read is a failure of the registry phase", async () => {
        writeFileSync(registryArchiveSource, "this is not an archive");

        const run = await runScript(["--edition", "community"]);

        expect(run.status, run.stderr).toBe(1);
        expect(run.stderr).toContain("FAILED in the registry-community phase (community)");
        expect(run.stderr).toContain("the registry-shaped archive could not be read");
        expectCleanEnd();
      }, 120_000);

      it("the leg loads the archive from the container's own output directory with a plain `load`, never `load -dev`, and tars with the registry's command", async () => {
        const run = await runScript(["--edition", "health"]);
        expect(run.status, run.stderr).toBe(0);

        const scripts = sessionScripts();
        expect(scripts.some((script) => script.includes(`Shell("load /tmp/iris-mcp-ipm-out/registry-root.tgz"`))).toBe(true);
        expect(scripts.filter((script) => script.includes("registry-root.tgz")).every((script) => !script.includes("load -dev"))).toBe(true);
        expect(scripts.some((script) => script.includes(`$ZF(-1,"${registryTarCommand()}")`))).toBe(true);
        expect(run.stderr).toMatch(/\[registry-health\] the registry-shaped archive installed on a fresh/);
      }, 120_000);
    });
  });

  describe("an archive that cannot be read ends the run in the archive phase", () => {
    it.each([
      ["a file that is not gzip", () => Buffer.from("this is not an archive"), "the archive is not a gzip file"],
      ["a gzip stream cut in the middle", (good: Buffer) => good.subarray(0, Math.floor(good.length / 2)), "the archive's gzip stream is damaged"],
    ])("%s", async (_label, make, reason) => {
      const bad = path.join(root, "unreadable.tgz");
      writeFileSync(bad, make(readFileSync(archiveSource)));
      archiveSource = bad;

      const run = await runScript(["--edition", "community"]);

      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain("FAILED in the archive phase");
      expect(run.stderr).toContain(`the archive could not be read: ${reason}`);
      expect(run.stderr, "no install container was started").not.toContain("[install-community]");
      expect(fake.calls().filter((call) => call.argv[0] === "run")).toHaveLength(1);
      expectCleanEnd();
    }, 120_000);
  });

  it("exits 4 and removes the generated container name when docker refuses to start the first container", async () => {
    const run = await runScript([], { FAKE_DOCKER_RUN_FAIL: "1" });

    expect(run.status, run.stderr).toBe(4);
    expect(run.stderr).toContain("FAILED in the build phase (community)");
    expect(run.stderr).toContain("the build container did not start");
    expect(dockerVerbs()).toEqual(["run", "rm"]);
    expectCleanEnd();
  }, 60_000);

  it("lists every parity mismatch, not the first few, when the two comparators disagree on many cases", async () => {
    writeConfig({ fail: "parity-many-mismatch" });

    const run = await runScript(["--edition", "community"]);

    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("FAILED in the parity-community phase (community)");
    expect(cases.length - 5, "more mismatches than any cap").toBeGreaterThan(20);
    expect(run.stderr).toContain(`disagree on ${cases.length - 5} case(s)`);
    for (const index of [5, 24, 25, cases.length - 1]) expect(run.stderr, `case ${index}`).toContain(`case ${index} `);
    expectCleanEnd();
  }, 120_000);

  it("ends the build phase with exit 1, naming it, when the archive cannot be copied out of the build container, and removes it", async () => {
    const run = await runScript(["--edition", "community"], { FAKE_DOCKER_CP_FAIL: "1" });

    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("FAILED in the build phase (community)");
    expect(run.stderr).toContain("the archive could not be copied out of build (exit 4)");
    expect(run.stderr).not.toContain("PASS:");
    expect(fake.calls().filter((call) => call.argv[0] === "run"), "no install container was started").toHaveLength(1);
    expectCleanEnd();
  }, 60_000);

  it("removes the container it is still waiting for, and exits 143, when SIGTERM arrives while the harness starts it", async () => {
    // The first readiness session of the build container signals this process and fails, so the signal is handled while `up` waits
    // (five seconds) for the container's session: the container exists, and the run has not yet returned from starting it.
    const run = await runScript(["--edition", "community"], { FAKE_DOCKER_READY_SIGNAL: "SIGTERM" });

    expect(run.status, run.stderr).toBe(143);
    expect(run.stderr).not.toContain("PASS:");
    expect(fake.calls().filter((call) => call.argv[0] === "run"), "the build container was the only one started").toHaveLength(1);
    expect(fake.containers(), "the container the harness was still starting is removed").toEqual({});
    expect(leftoverTempDirectories()).toEqual([]);
  }, 60_000);

  it("exits 3 when docker is not on PATH, and removes its temporary directory", async () => {
    const empty = path.join(root, "empty-path");
    mkdirSync(empty);

    const run = await runScript([], { PATH: empty });

    expect(run.status, run.stderr).toBe(3);
    expect(run.stderr).toMatch(/docker was not found on PATH/);
    expect(fake.calls()).toEqual([]);
    expect(leftoverTempDirectories()).toEqual([]);
  }, 60_000);

  it("refuses an unknown --edition with exit 2 before any container, and a dist that is not built with exit 2", async () => {
    const usage = await runScript(["--edition", "both"]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/usage: node scripts\/ci-ipm-archive\.mjs/);

    const unbuilt = path.join(root, "unbuilt");
    writeServedRepository(unbuilt);
    const lines: string[] = [];
    const code = await runIpmArchive({ repoRoot: unbuilt, env: { PATH: fake.binDir }, log: (line: string) => lines.push(line), tmpRoot: tmp });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/shared dist is not built/);
    expect(fake.calls(), "no docker call").toEqual([]);
    expect(leftoverTempDirectories()).toEqual([]);
  }, 60_000);

  it("refuses a repository with no committed IPM tree with exit 2 before any container, naming the command that writes it", async () => {
    const bare = path.join(root, "no-tree");
    mkdirSync(path.join(bare, "packages", "shared"), { recursive: true });
    symlinkSync(path.join(REPO_ROOT, "packages", "shared", "dist"), path.join(bare, "packages", "shared", "dist"));
    const lines: string[] = [];

    const code = await runIpmArchive({ repoRoot: bare, env: { PATH: fake.binDir }, log: (line: string) => lines.push(line), tmpRoot: tmp });

    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("refusing to run: module.xml is missing from the repository root: run pnpm gen:ipm.");
    expect(fake.calls(), "no docker call").toEqual([]);
    expect(leftoverTempDirectories()).toEqual([]);
  }, 60_000);

  it("removes every container and the temporary directory, and exits 143, when SIGTERM arrives during a session", async () => {
    writeConfig({ signalOn: "setup-newer.cls" });

    const run = await runScript(["--edition", "community"]);

    expect(run.status, run.stderr).toBe(143);
    expect(run.stderr).not.toContain("PASS:");
    expect(fake.containers(), "the container the run held is removed").toEqual({});
    expect(dockerVerbs().filter((verb) => verb === "rm").length).toBeGreaterThanOrEqual(2);
    expect(leftoverTempDirectories()).toEqual([]);
  }, 120_000);
});
