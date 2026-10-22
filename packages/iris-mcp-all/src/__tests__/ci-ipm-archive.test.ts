/**
 * Story 42.4 (AC 42.4.2, AC 42.4.4; DW-34, DW-674) -- `scripts/ci-ipm-archive.mjs` and its helpers (`scripts/lib/ipm-archive.mjs`), held in
 * the default suite WITHOUT a container engine.
 *
 *  - THE HELPERS. Staging from an embed (and its refusals), the declarations a manifest makes, the comparison of an archive with the embed
 *    over a real `tar czf` fixture, the split session markers and how they are read back, the parity comparison.
 *  - THE VERB SET (AC 42.4.4). The IPM verbs the session scripts issue equal `IPM_VERBS` in both directions, and none is `publish`,
 *    `install`, `repo`, `enable` or `update`: held over every script builder, over the source text of both files, and over the scripts a
 *    full scripted run feeds to its sessions.
 *  - THE SCRIPTED RUN. The script runs as a REAL process against the scripted docker of `fake-docker.ts`, whose session handler plays the
 *    IPM and IRIS side of every phase (`SESSION_HANDLER` below). A full run passes on both editions; each phase's fault ends the run with exit
 *    1 naming the phase and the edition, every container removed (the log of the failing one printed first) and the temporary directory
 *    gone; every container is started `--network none` with no `-p`; a signal during a session removes everything.
 *
 * Nothing here reaches a network or runs docker. The real IPM and IRIS behavior (what `load`, `package` and the install guard actually
 * do) is shown by running `node scripts/ci-ipm-archive.mjs` on throwaway containers, in CI's `ipm` job.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EDITIONS, PhaseFailure, parseArgs, runIpmArchive } from "../../../../scripts/ci-ipm-archive.mjs";
import { findExecutable } from "../../../../scripts/throwaway-iris.mjs";
import {
  ABSENT_DOCUMENT,
  FORBIDDEN_IPM_VERBS,
  GUARD_DOCUMENT,
  GUARD_REFUSAL_TEXT,
  IPM_VERBS,
  archiveNames,
  archiveProblems,
  classPathSegments,
  deleteSetupScript,
  embedProblems,
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
  normalizeText,
  outputDirectoryScript,
  parityProblems,
  parityScript,
  repositoriesScript,
  seedMarkers,
  sessionScript,
  setupStateScript,
  stageModule,
  stripTerminal,
  synthesizedSetup,
} from "../../../../scripts/lib/ipm-archive.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import {
  BOOTSTRAP_CLASSES,
  BOOTSTRAP_VERSION,
  IPM_INSTALL_GUARD,
  IPM_MODULE_NAME,
} from "../../../shared/src/bootstrap-classes.js";
import { classifyDeployedMarker, parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";
import { installFakeDocker, type FakeDocker } from "./fake-docker";
import { staleDistReason } from "./process-gate-helpers.js";

const SCRIPT = path.join(REPO_ROOT, "scripts", "ci-ipm-archive.mjs");
const PARITY_FIXTURE = path.join(REPO_ROOT, "packages", "shared", "src", "__tests__", "fixtures", "bootstrap-marker-parity-cases.json");

interface ParityCase {
  note: string;
  deployed: string;
  embedded: string;
  expected: string;
}

/** The real embed, from the sources of `@iris-mcp/shared` (the scripted run uses the built dist, which holds the same). */
function realEmbed() {
  return {
    marker: BOOTSTRAP_VERSION,
    classes: BOOTSTRAP_CLASSES,
    guard: IPM_INSTALL_GUARD,
    moduleName: IPM_MODULE_NAME,
    moduleXml: readFileSync(path.join(REPO_ROOT, "ipm", "module.xml"), "utf8"),
    classify: classifyDeployedMarker,
    parse: parseBootstrapMarker,
  };
}

type Embed = ReturnType<typeof realEmbed>;

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
  const moduleXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Export generator="IRIS" version="26"><Document name="iris-execute-mcp-v2.ZPM"><Module>',
    "<Name>iris-execute-mcp-v2</Name><Version>1.2.3</Version><SourcesRoot>src</SourcesRoot>",
    '<Resource Name="ExecuteMCPv2.InstallGuard.CLS" Preload="true"/>',
    ...[...classes.keys()].map((name) => `<Resource Name="${name.replace(/\.cls$/, ".CLS")}"/>`),
    '<Invoke Class="ExecuteMCPv2.InstallGuard" Method="Check" Phase="Initialize" When="After"/>',
    '<Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>',
    "</Module></Document></Export>",
    "",
  ].join("\n");
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

/** Every file under `directory`, relative, with forward slashes. */
function filesUnder(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(directory, entry.name), base) : [path.relative(base, path.join(directory, entry.name)).split(path.sep).join("/")],
  );
}

// -- the helpers ---------------------------------------------------------------------------

describe("stageModule (AD-14: the archive is built from the embed, never from src/)", () => {
  it("writes module.xml, one src/cls/<package path>.cls per embedded class and the preloaded guard, readable by everyone", () => {
    const directory = scratchDir();
    const embed = syntheticEmbed();

    const { files } = stageModule(directory, embed);

    expect(filesUnder(directory).sort()).toEqual(
      [
        "module.xml",
        "preload/src/cls/ExecuteMCPv2/InstallGuard.cls",
        "src/cls/ExecuteMCPv2/REST/Dispatch.cls",
        "src/cls/ExecuteMCPv2/Setup.cls",
        "src/cls/ExecuteMCPv2/Utils.cls",
      ].sort(),
    );
    expect(files.sort()).toEqual(filesUnder(directory).sort());
    expect(readFileSync(path.join(directory, "src/cls/ExecuteMCPv2/Setup.cls"), "utf8")).toBe(embed.classes.get("ExecuteMCPv2.Setup.cls"));
    expect(readFileSync(path.join(directory, "module.xml"), "utf8")).toBe(embed.moduleXml);
    for (const file of files) expect(statSync(path.join(directory, file)).mode & 0o777, file).toBe(0o644);
    for (const sub of ["", "src", "src/cls", "src/cls/ExecuteMCPv2", "src/cls/ExecuteMCPv2/REST", "preload", "preload/src/cls"]) {
      expect(statSync(path.join(directory, sub)).mode & 0o755, sub || "the stage").toBe(0o755);
    }
  });

  it("stages the real embed: 35 classes, the guard, the manifest, and nothing from src/ or any test class", () => {
    const directory = scratchDir();

    const { files } = stageModule(directory, realEmbed());

    expect(files.filter((file) => file.startsWith("src/cls/") && file.endsWith(".cls"))).toHaveLength(35);
    expect(files).toContain("preload/src/cls/ExecuteMCPv2/InstallGuard.cls");
    expect(files.some((file) => /Tests|QAFixtures/.test(file))).toBe(false);
    for (const [name, content] of BOOTSTRAP_CLASSES) {
      expect(readFileSync(path.join(directory, "src", "cls", ...classPathSegments(name)), "utf8").trimEnd()).toBe(content.trimEnd());
    }
  });

  it.each([
    ["a class that still holds the dev placeholder", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Utils.cls", 'Class ExecuteMCPv2.Utils\n{\nParameter BOOTSTRAPVERSION = "dev";\n}\n'), /dev placeholder/],
    ["a guard that still holds the dev placeholder", (embed: Embed) => (embed.guard = { ...embed.guard, content: embed.guard.content.replace(embed.marker, "dev") }), /dev placeholder/],
    ["a Setup stamped with another marker", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Setup.cls", `Class ExecuteMCPv2.Setup\n{\nParameter BOOTSTRAPVERSION = "9.9.9+9.bbbbbbbbbbbb";\n}\n`), /stamps the marker "9\.9\.9\+9\.bbbbbbbbbbbb"/],
    ["a guard stamped with another marker", (embed: Embed) => (embed.guard = { ...embed.guard, content: embed.guard.content.replace(embed.marker, "9.9.9+9.bbbbbbbbbbbb") }), /ExecuteMCPv2\.InstallGuard\.cls stamps the marker/],
    ["a Setup with no marker line", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Setup.cls", "Class ExecuteMCPv2.Setup\n{\n}\n"), /stamps the marker undefined/],
    ["a test class among the classes", (embed: Embed) => embed.classes.set("ExecuteMCPv2.Tests.UtilsTest.cls", "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n"), /test or fixture class/],
    ["a fixture class among the classes", (embed: Embed) => embed.classes.set("ExecuteMCPv2.QAFixtures.Thing.cls", "Class ExecuteMCPv2.QAFixtures.Thing\n{\n}\n"), /test or fixture class/],
    ["a manifest at another version", (embed: Embed) => (embed.moduleXml = embed.moduleXml.replace("<Version>1.2.3</Version>", "<Version>1.2.4</Version>")), /is at version "1\.2\.4"/],
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
    expect(declared.sourcesRoot).toBe("src");
    expect(declared.resources).toHaveLength(36);
    expect(declared.resources[0]).toEqual({ name: "ExecuteMCPv2.InstallGuard.CLS", preload: true });
    expect(declared.invokes[0], "the guard's Check carries CheckStatus").toStrictEqual({ class: "ExecuteMCPv2.InstallGuard", method: "Check", phase: "Initialize", when: "After", checkStatus: true });
    expect(declared.invokes[1]).toEqual({ class: "ExecuteMCPv2.Setup", method: "Configure", phase: "Configure", when: "After" });
    expect(declared.invokes[1]?.checkStatus, "an invoke with no CheckStatus attribute").toBeUndefined();
  });

  it("ignores comments, attribute order, the default packaging and explicit defaults: the same declarations", () => {
    const reserialized = `<?xml version="1.0"?><Export><Document name="x"><Module>
      <Name>iris-execute-mcp-v2</Name><Version>${markerSemver(BOOTSTRAP_VERSION)}</Version><SourcesRoot>src</SourcesRoot>
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
    expect(spawnSync("tar", ["czf", archive, "-C", stage, "."]).status).toBe(0);
    const members = (spawnSync("tar", ["tzf", archive], { encoding: "utf8" }).stdout ?? "").split("\n").filter((line) => line !== "");
    expect(spawnSync("tar", ["xzf", archive, "-C", extracted]).status).toBe(0);
    return { members, extracted };
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

    const doubled = members.map((member) => member.replace("src/cls/", "src//cls/"));
    expect(archiveProblems(doubled, extracted, embed)).toEqual([]);
  });

  it("tolerates line-end and trailing-whitespace differences, which an export may introduce", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed, (stage) => {
      const file = path.join(stage, "src/cls/ExecuteMCPv2/Utils.cls");
      writeFileSync(file, `${readFileSync(file, "utf8").replace(/\n/g, "\r\n")}\r\n\r\n`);
    });

    expect(archiveProblems(members, extracted, embed)).toEqual([]);
    expect(normalizeText("a\r\nb  \r\n\r\n")).toBe("a\nb");
  });

  it.each([
    ["a changed class", (stage: string) => writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/Utils.cls"), "Class ExecuteMCPv2.Utils\n{\n// edited\n}\n"), /src\/cls\/ExecuteMCPv2\/Utils\.cls differs from the embed/],
    ["a changed guard", (stage: string) => writeFileSync(path.join(stage, "preload/src/cls/ExecuteMCPv2/InstallGuard.cls"), "Class ExecuteMCPv2.InstallGuard\n{\n}\n"), /InstallGuard\.cls differs from the embed/],
    ["a missing class", (stage: string) => rmSync(path.join(stage, "src/cls/ExecuteMCPv2/REST/Dispatch.cls")), /carries 2 src\/cls class member\(s\), the embed 3|missing src\/cls\/ExecuteMCPv2\/REST\/Dispatch\.cls/],
    ["a missing guard", (stage: string) => rmSync(path.join(stage, "preload"), { recursive: true }), /missing preload\/src\/cls\/ExecuteMCPv2\/InstallGuard\.cls/],
    ["a missing manifest", (stage: string) => rmSync(path.join(stage, "module.xml")), /no module\.xml/],
    ["an extra class", (stage: string) => writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/Extra.cls"), "Class ExecuteMCPv2.Extra\n{\n}\n"), /not an embedded class/],
    ["a test class", (stage: string) => {
      mkdirSync(path.join(stage, "src/cls/ExecuteMCPv2/Tests"), { recursive: true });
      writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/Tests/UtilsTest.cls"), "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n");
    }, /test or fixture member src\/cls\/ExecuteMCPv2\/Tests\/UtilsTest\.cls/],
    ["a fixture class", (stage: string) => writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/QAFixtures.cls"), "Class ExecuteMCPv2.QAFixtures\n{\n}\n"), /test or fixture member/],
  ])("reports %s", (_label, mutate, problem) => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed, mutate);

    expect(archiveProblems(members, extracted, embed).join(" ")).toMatch(problem);
  });

  it("reports a member that cannot be read from the extracted tree instead of passing it", () => {
    const embed = syntheticEmbed();
    const { members, extracted } = archiveOf(embed);
    rmSync(path.join(extracted, "src/cls/ExecuteMCPv2/Setup.cls"));

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

  it("publishes, uploads and reads no secret: the script and its helpers hold none of those words as a statement", () => {
    for (const file of ["scripts/ci-ipm-archive.mjs", "scripts/lib/ipm-archive.mjs"]) {
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
  const marker = (name, value) => "IRISMCP-" + name + "-START:" + value + ":IRISMCP-" + name + "-END\n";
  const repositories = (after) => marker("REPOSITORIES", fail === "repositories-after-" + after ? "1" : "0");
  const log = (line) => fs.appendFileSync(path.join(dir, "handler.log"), line + "\n");
  if (config.signalOn && stdin.includes(config.signalOn)) process.kill(process.ppid, "SIGTERM");
  let out = "";

  if (stdin.includes("OBJ.Load(\"/usr/irissys/dist/install/misc/zpm.xml\"")) {
    out += marker("IPM", fail === "import" ? "FAILED:ERROR #5001: scripted" : "OK") + repositories("import");
  } else if (stdin.includes("Shell(\"load -dev ")) {
    out += (fail === "load-dev" ? "" : "") + marker("COMMAND", fail === "load-dev" ? "FAILED:ERROR #5001: scripted load -dev failure" : "OK") + repositories("load-dev");
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
  } else if (stdin.includes("Shell(\"load /opt/iris-mcp/install/")) {
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
      state.setup = fail === "version-wrong" ? config.marker + "x" : config.marker;
    } else if (fail === "guard-setup-changed") {
      state.setup = config.marker;
    } else if (fail === "guard-leaves-guard") {
      state.guardDefined = true;
    } else if (fail === "guard-leaves-module") {
      state.installed = true;
    }
    save();
    out += marker("COMMAND", outcome) + repositories("load");
    if (state.installed) out += "iris-execute-mcp-v2 " + config.semver + "\n";
  } else if (stdin.includes("Shell(\"list\"")) {
    const listed = fail === "list-version-wrong" ? "0.0.0" : config.semver;
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
    out += marker("COMPILED", fail === "compiled-count" ? "35" : "36") + marker("TESTCLASSES", fail === "test-classes" ? "2" : "0");
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
  let toolsDir = "";
  let embed: Embed;
  let cases: ParityCase[];

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
    expect(spawnSync("tar", ["czf", archiveSource, "-C", stage, "."]).status).toBe(0);

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

    // The script lists and extracts the archive with `tar`; the harness's PATH holds the scripted docker and a directory with nothing but tar.
    const tar = findExecutable("tar", process.env.PATH);
    expect(tar, "tar is on this machine's PATH").toBeDefined();
    toolsDir = path.join(root, "tools");
    mkdirSync(toolsDir);
    symlinkSync(tar as string, path.join(toolsDir, "tar"));
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
  }

  /** Run the script as a process whose PATH is the scripted docker's directory alone and whose temp directory is `tmp`. */
  function runScript(args: string[], env: Record<string, string> = {}, afterStart?: () => void): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: {
          PATH: `${fake.binDir}${path.delimiter}${toolsDir}`,
          TMPDIR: tmp,
          FAKE_DOCKER_DIR: fake.dir,
          FAKE_DOCKER_SESSION_HANDLER: path.join(root, "handler.cjs"),
          FAKE_DOCKER_CP_SOURCE: archiveSource,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.once("error", reject);
      child.once("close", (status) => resolve({ status, stdout, stderr }));
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
    expect(run.stderr).toContain("PASS: one archive of iris-execute-mcp-v2");
    expect(run.stderr).toContain("0 package-registry rows");

    const runs = fake.calls().filter((call) => call.argv[0] === "run");
    expect(runs, "a build container and one install container per edition").toHaveLength(3);
    expect(runs.map((call) => call.argv[call.argv.length - 1])).toEqual([
      EDITIONS.community.image,
      EDITIONS.community.image,
      EDITIONS.health.image,
    ]);
    expect(dockerVerbs().filter((verb) => verb === "rm")).toHaveLength(3);
    expect(dockerVerbs().filter((verb) => verb === "cp")).toHaveLength(1);
    expect(dockerVerbs().filter((verb) => verb === "logs"), "no log is read when everything passes").toHaveLength(0);
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
    ["community", ["build", "install-community"], 2],
    ["health", ["build", "install-health"], 2],
  ])("--edition %s starts the build container and that edition's install container only", async (edition, phases, containers) => {
    const run = await runScript(["--edition", edition]);

    expect(run.status, run.stderr).toBe(0);
    expect(fake.calls().filter((call) => call.argv[0] === "run")).toHaveLength(containers);
    for (const phase of phases) expect(run.stderr).toContain(`[${phase}]`);
    expect(run.stderr).not.toContain(edition === "community" ? "[install-health]" : "[install-community]");
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
    ["fresh-load-fails", "health", "install-health", "health", "load of the archive on a fresh container did not succeed"],
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
      expect(spawnSync("tar", ["czf", bad, "-C", stage, "."]).status).toBe(0);
      archiveSource = bad;
    }

    it.each([
      ["a class that differs from the embed", (stage: string) => writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/Utils.cls"), "Class ExecuteMCPv2.Utils\n{\n// edited after the embed\n}\n"), "differs from the embed"],
      ["a missing class", (stage: string) => rmSync(path.join(stage, "src/cls/ExecuteMCPv2/REST/Dispatch.cls")), "the archive is missing src/cls/ExecuteMCPv2/REST/Dispatch.cls"],
      ["a test class", (stage: string) => {
        mkdirSync(path.join(stage, "src/cls/ExecuteMCPv2/Tests"), { recursive: true });
        writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/Tests/UtilsTest.cls"), "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n");
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
    mkdirSync(path.join(unbuilt, "ipm"), { recursive: true });
    writeFileSync(path.join(unbuilt, "ipm", "module.xml"), embed.moduleXml);
    const lines: string[] = [];
    const code = await runIpmArchive({ repoRoot: unbuilt, env: { PATH: fake.binDir }, log: (line: string) => lines.push(line), tmpRoot: tmp });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/shared dist is not built/);
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
