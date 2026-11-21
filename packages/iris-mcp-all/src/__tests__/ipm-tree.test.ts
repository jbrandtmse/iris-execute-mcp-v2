/**
 * Story 42.8 (decision #122; AD-14) -- the committed IPM tree, held by `pnpm gen:ipm:check` (`scripts/lib/ipm-tree.mjs`, run by
 * `scripts/gen-bootstrap.mjs --ipm-check`): the root `module.xml`, the stamped classes under `ipm/src/cls/` and the stamped guard under
 * `preload/ipm/src/cls/` are unedited generator output at the shared version, and nothing else lives where IPM reads.
 *
 *  - THE REAL REPOSITORY. `ipmTreeProblems` finds nothing wrong with the checked-in tree, and the real CLI exits 0 on it.
 *  - THE TAMPER ROWS. Each row copies the real tree into a scratch directory, changes ONE thing, and the check names the path it found
 *    (or the version, or the marker). Hand edits are tried in forms a canonical-only fixture set cannot see (Rule #58): a one-byte edit,
 *    CRLF line ends, a trailing blank line, a byte-order mark.
 *  - THE CLI. The same row through `node scripts/gen-bootstrap.mjs --ipm-check` in a scratch generator tree exits 1 and prints the path.
 *  - NO EXPORT RULES (decision #124). `.gitattributes` holds no `export-ignore` and no `export-subst`, and no path the IPM module needs
 *    or the registry reads carries one, so GitHub's archive of a commit stays the whole repository.
 *
 * Rows that depend on the tree being at a version commit are not here: between releases the tree is frozen at the last released content
 * while the embed moves, so no test asserts the tree equals the embed (the generator's own tests do, in a scratch tree).
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ipmTreeMarker, ipmTreeProblems, manifestDeclarations, readIpmTree } from "../../../../scripts/lib/ipm-tree.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { copyGeneratorInputs, copyIpmTree } from "../../../shared/src/__tests__/gen-bootstrap-scratch";

const SHARED_VERSION = (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "shared", "package.json"), "utf8")) as { version: string }).version;
const GUARD = "preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls";
const SETUP = "ipm/src/cls/ExecuteMCPv2/Setup.cls";
const UTILS = "ipm/src/cls/ExecuteMCPv2/Utils.cls";

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A scratch repository holding the real committed tree and the shared package's manifest (the check's default shared version). */
function scratchTree(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ipm-tree-test-"));
  scratch.push(directory);
  mkdirSync(path.join(directory, "packages", "shared"), { recursive: true });
  writeFileSync(path.join(directory, "packages", "shared", "package.json"), readFileSync(path.join(REPO_ROOT, "packages", "shared", "package.json")));
  copyIpmTree(directory, REPO_ROOT);
  return directory;
}

const read = (root: string, file: string) => readFileSync(path.join(root, file), "utf8");
const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

describe("the committed tree is unedited generator output (the real repository)", () => {
  it("ipmTreeProblems finds nothing wrong with it, at the shared version", () => {
    expect(ipmTreeProblems(REPO_ROOT, { sharedVersion: SHARED_VERSION, moduleName: "iris-execute-mcp-v2" })).toEqual([]);
    expect(ipmTreeProblems(REPO_ROOT), "and with the default shared version read from packages/shared/package.json").toEqual([]);
  });

  it("holds one class file per class resource of its own module.xml (never the moving classes[] roster), the guard and nothing else under preload/, and no root requirements.txt", () => {
    const tree = readIpmTree(REPO_ROOT);
    const classResources = manifestDeclarations(tree.manifest ?? "").resources.filter((resource) => !resource.preload);

    expect(classResources.length, "the manifest's resources were read").toBeGreaterThan(0);
    expect([...tree.sourceFiles.keys()].filter((file) => file.endsWith(".cls")).sort()).toEqual(classResources.map((resource) => `ipm/src/cls/${resource.name.replace(/\.CLS$/, "").split(".").join("/")}.cls`).sort());
    expect([...tree.sourceFiles.keys()].every((file) => file.startsWith("ipm/src/cls/ExecuteMCPv2/") && file.endsWith(".cls"))).toBe(true);
    expect([...tree.preloadFiles.keys()]).toEqual([GUARD]);
    expect(tree.hasRequirements).toBe(false);
    expect(tree.manifest?.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
  });

  it("stamps one marker, <version>+<sequence>.<hash>, in Setup and in the guard, and ipmTreeMarker reads it", () => {
    const marker = ipmTreeMarker(REPO_ROOT);

    expect(marker).toMatch(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/);
    expect(marker?.split("+")[0]).toBe(SHARED_VERSION);
    expect(read(REPO_ROOT, SETUP)).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(read(REPO_ROOT, GUARD)).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
  });

  it("is clean through the real CLI: `node scripts/gen-bootstrap.mjs --ipm-check` exits 0 and prints OK", () => {
    const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "gen-bootstrap.mjs"), "--ipm-check"], { encoding: "utf8", cwd: REPO_ROOT });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("gen:ipm:check: OK");
    expect(run.stderr).toBe("");
  });

  it("loses no file to .gitignore: a clean checkout holds every file of the tree (the ExecuteMCPv2.Coverage package sits under a `Coverage/` path)", () => {
    const run = spawnSync("git", ["-c", "core.ignorecase=true", "ls-files", "--others", "--ignored", "--exclude-standard", "--", "module.xml", "ipm/src", "preload"], { encoding: "utf8", cwd: REPO_ROOT });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split("\n").filter((line) => line !== ""), "tree files that git ignores").toEqual([]);
    // Committed tree files that an ignore rule matches: the version step's `git add` of a regenerated tree would leave such a file
    // out (and a new one would never be committed), so no tracked tree file may match one. Matched case-insensitively on every host,
    // as on the macOS and Windows checkouts that run the version step (`coverage/` matches `Coverage/` there, not on Linux CI).
    const tracked = spawnSync("git", ["-c", "core.ignorecase=true", "ls-files", "--cached", "--ignored", "--exclude-standard", "--", "module.xml", "ipm/src", "preload"], { encoding: "utf8", cwd: REPO_ROOT });

    expect(tracked.status, tracked.stderr).toBe(0);
    expect(tracked.stdout.trim().split("\n").filter((line) => line !== ""), "committed tree files that an ignore rule matches").toEqual([]);
  });

  it("is registered as the root script gen:ipm:check and written by gen:ipm, and prettier never reformats it", () => {
    const scripts = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

    expect(scripts["gen:ipm"]).toBe("node scripts/gen-bootstrap.mjs --ipm");
    expect(scripts["gen:ipm:check"]).toBe("node scripts/gen-bootstrap.mjs --ipm-check");
    expect(scripts["gen:bootstrap"], "the plain generator never writes the tree").toBe("node scripts/gen-bootstrap.mjs");
    const ignored = readFileSync(path.join(REPO_ROOT, ".prettierignore"), "utf8").split("\n");
    for (const entry of ["/module.xml", "/ipm/src/", "/preload/"]) expect(ignored, entry).toContain(entry);
  });
});

describe("each tamper row is refused, naming the path, the version or the marker", () => {
  it("a one-byte edit of a class: the tree no longer hashes to the marker it carries", () => {
    const root = scratchTree();
    write(root, UTILS, read(root, UTILS).replace("Class ExecuteMCPv2.Utils", "Class ExecuteMCPv2.Utilz"));

    const problems = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the tree under ipm\/src and preload does not hash to the marker \d+\.\d+\.\d+\+\d+\.[0-9a-f]{12} it carries: the tree was edited by hand\. Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git\.$/);
  });

  it.each([
    ["Setup, which carries the stamp", SETUP],
    ["the guard", GUARD],
  ])("a one-byte edit of %s is refused too", (_label, file) => {
    const root = scratchTree();
    write(root, file, read(root, file).replace("Class ExecuteMCPv2.", "Class  ExecuteMCPv2."));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n")).toContain("does not hash to the marker");
  });

  it.each([
    ["CRLF line ends", (text: string) => text.replace(/\n/g, "\r\n")],
    ["a trailing blank line", (text: string) => `${text}\n`],
    ["trailing whitespace on the last line", (text: string) => `${text.trimEnd()}  \n`],
    ["no final newline", (text: string) => text.trimEnd()],
    ["a byte-order mark", (text: string) => `\uFEFF${text}`],
  ])("a class re-saved with %s is refused, naming the file (the content hash alone cannot see line ends)", (_label, change) => {
    const root = scratchTree();
    write(root, UTILS, change(read(root, UTILS)));

    const problems = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(new RegExp(`${UTILS.replace(/\./g, "\\.")} is not in the form the generator writes|does not hash to the marker`));
  });

  it("an edit of module.xml (its description) is refused: it is not what the generator writes for the tree it describes", () => {
    const root = scratchTree();
    write(root, "module.xml", read(root, "module.xml").replace("An independent community project.", "An official project."));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([expect.stringMatching(/^module\.xml is not what the generator writes for the tree it describes \(SourcesRoot ipm\/src\)\./)]);
  });

  it("a SourcesRoot changed in module.xml is refused (the render uses ipm/src whatever the file says)", () => {
    const root = scratchTree();
    write(root, "module.xml", read(root, "module.xml").replace("<SourcesRoot>ipm/src</SourcesRoot>", "<SourcesRoot>src</SourcesRoot>"));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n")).toContain("module.xml is not what the generator writes for the tree it describes");
  });

  it("a resource dropped from module.xml leaves its class file in the tree, which is refused naming the path", () => {
    const root = scratchTree();
    write(root, "module.xml", read(root, "module.xml").replace(/ *<Resource Name="ExecuteMCPv2\.REST\.Coverage\.CLS"\/>\n/, ""));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n")).toContain("ipm/src/cls/ExecuteMCPv2/REST/Coverage.cls is not a resource of module.xml");
  });

  it("a <Resource> with no Name is a reported problem, never a thrown TypeError", () => {
    const root = scratchTree();
    write(root, "module.xml", read(root, "module.xml").replace('<Resource Name="ExecuteMCPv2.REST.Coverage.CLS"/>', "<Resource/>"));

    let problems: string[] = [];
    expect(() => {
      problems = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION });
    }).not.toThrow();
    expect(problems.join("\n")).toContain("module.xml declares 1 <Resource> with no Name, which the generator never writes.");
  });

  it("a <Resource> line repeated by hand, with the header's counts edited to match, is refused: the re-rendering repeats it and the file map absorbs it", () => {
    const root = scratchTree();
    const line = '<Resource Name="ExecuteMCPv2.REST.Coverage.CLS"/>';
    const manifest = read(root, "module.xml");
    const indent = /\n([ \t]*)<Resource Name="ExecuteMCPv2\.REST\.Coverage\.CLS"\/>/.exec(manifest)?.[1] ?? "";
    const counts = /(\d+) resources: the preloaded ExecuteMCPv2\.InstallGuard and the (\d+) classes/.exec(manifest);
    expect(counts, "the header states the counts").not.toBeNull();
    const recounted = manifest.replace(counts![0], `${Number(counts![1]) + 1} resources: the preloaded ExecuteMCPv2.InstallGuard and the ${Number(counts![2]) + 1} classes`);
    write(root, "module.xml", recounted.replace(line, `${line}\n${indent}${line}`));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([
      "module.xml declares the resource ExecuteMCPv2.REST.Coverage.CLS more than once, which the generator never writes. Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git.",
    ]);
  });

  it("a module.xml that names another module is refused when the name is given", () => {
    const root = scratchTree();
    write(root, "module.xml", read(root, "module.xml").replace(/<Name>iris-execute-mcp-v2<\/Name>/, "<Name>other-module</Name>"));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION, moduleName: "iris-execute-mcp-v2" }).join("\n")).toContain('module.xml names the module "other-module", not "iris-execute-mcp-v2"');
  });

  it("a missing module.xml is refused: IPM finds no module", () => {
    const root = scratchTree();
    rmSync(path.join(root, "module.xml"));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual(["module.xml is missing from the repository root, so IPM finds no module. Run pnpm gen:ipm."]);
  });

  it("an extra class under ipm/src is refused, naming the path", () => {
    const root = scratchTree();
    write(root, "ipm/src/cls/ExecuteMCPv2/Extra.cls", "Class ExecuteMCPv2.Extra\n{\n}\n");

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([
      "ipm/src/cls/ExecuteMCPv2/Extra.cls is not a resource of module.xml: the tree holds a file the generator did not write. Remove it, or restore the tree from git.",
    ]);
  });

  it("a macOS .DS_Store under ipm/src or preload/ (ignored by git, never committed) is not a file of the tree, while any other dotfile is", () => {
    const root = scratchTree();
    write(root, "ipm/src/cls/ExecuteMCPv2/.DS_Store", "\u0000\u0000\u0000\u0001Bud1");
    write(root, "preload/.DS_Store", "\u0000\u0000\u0000\u0001Bud1");

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([]);

    write(root, "preload/.hidden", "x");
    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n")).toContain("preload/.hidden is under preload/");
  });

  it("a test or fixture class in the tree is refused, naming the path", () => {
    const root = scratchTree();
    write(root, "ipm/src/cls/ExecuteMCPv2/Tests/UtilsTest.cls", "Class ExecuteMCPv2.Tests.UtilsTest\n{\n}\n");

    const joined = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n");

    expect(joined).toContain("ipm/src/cls/ExecuteMCPv2/Tests/UtilsTest.cls is a test or fixture class: the tree never carries one.");
  });

  it("a class file missing from the tree is refused, naming the path, and the hash is not judged over the rest", () => {
    const root = scratchTree();
    rmSync(path.join(root, "ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls"));

    const problems = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION });

    expect(problems).toEqual(["ipm/src/cls/ExecuteMCPv2/REST/Dispatch.cls is missing from the tree. Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git."]);
  });

  it("any file under preload/ but the guard is refused, naming the path: IPM imports everything there", () => {
    const root = scratchTree();
    write(root, "preload/other.txt", "x\n");

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([
      "preload/other.txt is under preload/, where nothing but the stamped guard may live: IPM imports everything under <module root>/preload.",
    ]);
  });

  it("a guard moved out of preload/ is refused: it is missing there and extra under ipm/src", () => {
    const root = scratchTree();
    renameSync(path.join(root, GUARD), path.join(root, "ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"));

    const joined = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n");

    expect(joined).toContain(`${GUARD} is missing from the tree.`);
    expect(joined).toContain("ipm/src/cls/ExecuteMCPv2/InstallGuard.cls is not a resource of module.xml");
  });

  it("a requirements.txt at the root is refused: IPM would run pip install -r on it", () => {
    const root = scratchTree();
    write(root, "requirements.txt", "left-pad\n");

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([
      "requirements.txt exists at the repository root: IPM runs pip install -r on it when the module is installed. Remove it.",
    ]);
  });

  it("version drift: a tree at one version and a shared version at the next is refused with the matrix's text", () => {
    const root = scratchTree();
    const [major, minor, patch] = SHARED_VERSION.split(".").map(Number) as [number, number, number];
    const next = `${major}.${minor}.${patch + 1}`;

    expect(ipmTreeProblems(root, { sharedVersion: next })).toEqual([`module.xml is at ${SHARED_VERSION}, not the shared version ${next}. Run pnpm run version.`]);
  });

  it("a dev placeholder left in Setup is refused, naming the file", () => {
    const root = scratchTree();
    const marker = ipmTreeMarker(root) as string;
    write(root, SETUP, read(root, SETUP).replace(`Parameter BOOTSTRAPVERSION = "${marker}";`, 'Parameter BOOTSTRAPVERSION = "dev";'));

    const joined = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n");

    expect(joined).toContain(`${SETUP} still holds the dev placeholder`);
  });

  it("Setup and the guard stamping different markers are refused, naming both", () => {
    const root = scratchTree();
    const marker = ipmTreeMarker(root) as string;
    const other = marker.replace(/\+\d+\./, "+99.");
    write(root, GUARD, read(root, GUARD).replace(`"${marker}"`, `"${other}"`));

    const joined = ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n");

    expect(joined).toContain(`Setup and the guard stamp different markers (${SETUP}: ${marker}; ${GUARD}: ${other}).`);
  });

  it("a marker whose version is not the module.xml version is refused (the version step stamped one and not the other)", () => {
    const root = scratchTree();
    const marker = ipmTreeMarker(root) as string;
    const other = marker.replace(/^\d+\.\d+\.\d+/, "9.9.9");
    for (const file of [SETUP, GUARD]) write(root, file, read(root, file).replace(`"${marker}"`, `"${other}"`));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION })).toEqual([
      `the tree stamps ${other}, whose version is not the module.xml <Version> ${SHARED_VERSION}. Run pnpm run version.`,
    ]);
  });

  it("a marker that is not <semver>+<sequence>.<hash> is refused", () => {
    const root = scratchTree();
    const marker = ipmTreeMarker(root) as string;
    for (const file of [SETUP, GUARD]) write(root, file, read(root, file).replace(`"${marker}"`, '"not-a-marker"'));

    expect(ipmTreeProblems(root, { sharedVersion: SHARED_VERSION }).join("\n")).toContain('the marker "not-a-marker" stamped in the tree is not <semver>+<sequence>.<hash>.');
  });
});

describe("the same rows through the real CLI, in a scratch generator tree", () => {
  /** A scratch repository holding the generator, its inputs and the real tree, so `--ipm-check` runs as a process there. */
  function scratchGenerator(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "ipm-tree-cli-"));
    scratch.push(directory);
    copyGeneratorInputs(directory, REPO_ROOT);
    copyIpmTree(directory, REPO_ROOT);
    return directory;
  }
  const check = (root: string) => spawnSync(process.execPath, [path.join(root, "scripts", "gen-bootstrap.mjs"), "--ipm-check"], { encoding: "utf8", cwd: root });

  it("exits 0 on the real tree copied into the scratch repository", () => {
    expect(check(scratchGenerator()).status).toBe(0);
  });

  it("exits 1 (not a crash) naming the problem when module.xml holds a <Resource> with no Name", () => {
    const nameless = scratchGenerator();
    write(nameless, "module.xml", read(nameless, "module.xml").replace('<Resource Name="ExecuteMCPv2.REST.Coverage.CLS"/>', "<Resource/>"));

    const run = check(nameless);

    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("module.xml declares 1 <Resource> with no Name");
    expect(run.stderr).not.toContain("TypeError");
  });

  it("exits 1 naming the path when a class is edited by hand, an extra file is added to preload/, or module.xml is edited", () => {
    const edited = scratchGenerator();
    appendFileSync(path.join(edited, UTILS), "// by hand\n");
    const hash = check(edited);
    expect(hash.status).toBe(1);
    expect(hash.stderr).toContain("gen:ipm:check found 1 problem(s) in the committed IPM tree");
    expect(hash.stderr).toContain("does not hash to the marker");

    const extra = scratchGenerator();
    write(extra, "preload/other.txt", "x\n");
    const extraRun = check(extra);
    expect(extraRun.status).toBe(1);
    expect(extraRun.stderr).toContain("preload/other.txt is under preload/");

    const manifest = scratchGenerator();
    write(manifest, "module.xml", read(manifest, "module.xml").replace("mcp model-context-protocol", "mcp"));
    const manifestRun = check(manifest);
    expect(manifestRun.status).toBe(1);
    expect(manifestRun.stderr).toContain("module.xml is not what the generator writes");
  });

  it("exits 1 on version drift: the shared version raised without the version step", () => {
    const root = scratchGenerator();
    const sharedFile = path.join(root, "packages", "shared", "package.json");
    const shared = JSON.parse(readFileSync(sharedFile, "utf8")) as { version: string };
    writeFileSync(sharedFile, JSON.stringify({ ...shared, version: "9.9.9" }));

    const run = check(root);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`module.xml is at ${SHARED_VERSION}, not the shared version 9.9.9. Run pnpm run version.`);
  });
});

describe("no export rules (decision #124): GitHub's archive of a commit stays the whole repository", () => {
  it(".gitattributes holds no export-ignore and no export-subst", () => {
    const attributes = readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8");

    expect(attributes).not.toMatch(/export-ignore|export-subst/);
  });

  it("git reports no export attribute for the module's files or for the rest of the repository, as `git check-attr` reads them", () => {
    const paths = ["module.xml", "ipm/src/cls/ExecuteMCPv2/Utils.cls", GUARD, "README.md", "LICENSE", "docs/README.md", "packages/shared/package.json", ".github/workflows/ci.yml", "_bmad-output/x.md", "ipm/preload/ExecuteMCPv2/InstallGuard.cls"];
    const run = spawnSync("git", ["check-attr", "export-ignore", "export-subst", "--", ...paths], { encoding: "utf8", cwd: REPO_ROOT });

    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(paths.length * 2);
    expect(lines.every((line) => line.endsWith(": unspecified")), run.stdout).toBe(true);
  });
});
