/**
 * Fixtures shared by the tests of the IPM archive proof (`ci-ipm-archive.test.ts`, `ci-ipm-archive-tgz.test.ts`): the real embed as
 * `scripts/lib/ipm-archive.mjs` takes it, a `tar czf` of a directory that holds nothing the archive proof does not expect, and the
 * stand-ins of the served-archive leg (Story 42.8, DW-694): a repository directory shaped like the real one, a `git` that answers
 * `ls-files` and `archive` from files, and a `fetch` that answers from a file.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderModuleXml } from "../../../../scripts/lib/ipm-tree.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import {
  BOOTSTRAP_CLASSES,
  BOOTSTRAP_VERSION,
  IPM_INSTALL_GUARD,
  IPM_MODULE_NAME,
} from "../../../shared/src/bootstrap-classes.js";
import { classifyDeployedMarker, parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";

/** The real embed, from the sources of `@iris-mcp/shared` (the scripted run uses the built dist, which holds the same). */
export function realEmbed() {
  return {
    marker: BOOTSTRAP_VERSION,
    classes: BOOTSTRAP_CLASSES,
    guard: IPM_INSTALL_GUARD,
    moduleName: IPM_MODULE_NAME,
    moduleXml: renderModuleXml({
      moduleName: IPM_MODULE_NAME,
      version: BOOTSTRAP_VERSION.split("+")[0] as string,
      classNames: [...BOOTSTRAP_CLASSES.keys()],
      guardName: IPM_INSTALL_GUARD.name,
    }),
    classify: classifyDeployedMarker,
    parse: parseBootstrapMarker,
  };
}

export type Embed = ReturnType<typeof realEmbed>;

/** Every file under `directory`, relative, with forward slashes, sorted. */
export function filesUnder(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(directory, entry.name), base) : [path.relative(base, path.join(directory, entry.name)).split(path.sep).join("/")],
    )
    .sort();
}

/**
 * `tar czf <archive> [extra...] -C <directory> .`, with `COPYFILE_DISABLE=1` so that a macOS `tar` stores no AppleDouble `._` member
 * next to a file that carries an extended attribute: such a member is a real member of the archive, which no IPM archive holds.
 * Returns the exit status and what `tar` wrote to stderr (or why it could not be started), for an assertion message.
 */
export function tarGz(archive: string, directory: string, extra: string[] = []): { status: number | null; stderr: string } {
  const made = spawnSync("tar", ["czf", archive, ...extra, "-C", directory, "."], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { status: made.status, stderr: `${made.stderr ?? ""}${made.error?.message ?? ""}` };
}

// -- the served-archive leg --------------------------------------------------------------------

/** The repository and the commit the CI rows run as: the values of `GITHUB_REPOSITORY` and `GITHUB_SHA`. */
export const SERVED_REPOSITORY = "jbrandtmse/iris-execute-mcp-v2";
export const SERVED_SHA = "0123456789abcdef0123456789abcdef01234567";
/** The folder GitHub's archive of that commit wraps the repository in. */
export const SERVED_PREFIX = `iris-execute-mcp-v2-${SERVED_SHA}`;

/** The members the real repository's IPM tree holds, from the real files: the root `module.xml` and every file under `ipm/src` and `preload`. */
export function realTreeMembers(): string[] {
  const under = (directory: string) => filesUnder(path.join(REPO_ROOT, directory)).map((file) => `${directory}/${file}`);
  return ["module.xml", ...under("ipm/src"), ...under("preload")];
}

/**
 * Write a repository to `directory`: the REAL committed IPM tree (the root `module.xml`, `ipm/src`, `preload`), copied byte for byte,
 * plus files a whole repository holds that the module does not need. Returns the members `git ls-files ipm/src preload` would list.
 */
export function writeServedRepository(directory: string): string[] {
  for (const entry of ["module.xml", "ipm/src", "preload"]) {
    const target = path.join(directory, entry);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(REPO_ROOT, entry), target, { recursive: true });
  }
  for (const [file, text] of [
    ["README.md", "# A stand-in repository README\n"],
    ["LICENSE", readFileSync(path.join(REPO_ROOT, "LICENSE"), "utf8")],
    ["packages/shared/src/index.ts", "export const stand_in = 1;\n"],
    ["docs/notes.md", "Notes the module does not need.\n"],
    ["ipm/preload/ExecuteMCPv2/InstallGuard.cls", "Class ExecuteMCPv2.InstallGuard\n{\nParameter BOOTSTRAPVERSION = \"dev\";\n}\n"],
  ] as const) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), text);
  }
  return filesUnder(directory)
    .filter((file) => file.startsWith("ipm/src/") || file.startsWith("preload/"))
    .sort();
}

/**
 * `git archive --format=tar.gz HEAD` of a repository directory, as git writes it: members with no `./` and no wrapping folder.
 * Made with the host tar, which is the oracle for the archive's members and bytes.
 */
export function gitArchiveOf(directory: string, archive: string): void {
  const names = filesUnder(directory);
  const made = spawnSync("tar", ["czf", archive, "-C", directory, ...names], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (made.status !== 0) throw new Error(`tar failed: ${made.stderr}`);
}

/**
 * GitHub's archive of a commit, as `codeload.github.com/<repository>/tar.gz/<sha>` serves it: the repository's members under one
 * folder, `<repo>-<sha>/`, with the folder as a member of its own.
 */
export function githubArchiveOf(directory: string, archive: string, wrapperRoot: string): void {
  const wrapped = path.join(wrapperRoot, SERVED_PREFIX);
  mkdirSync(wrapped, { recursive: true });
  cpSync(directory, wrapped, { recursive: true });
  const made = spawnSync("tar", ["czf", archive, "-C", wrapperRoot, SERVED_PREFIX], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (made.status !== 0) throw new Error(`tar failed: ${made.stderr}`);
}

/**
 * A stand-in `git` for a process whose PATH holds nothing else. It answers the two verbs the served-archive leg issues and nothing else
 * (any other verb exits 99 and is recorded):
 *  - `ls-files ...`: prints the file `FAKE_GIT_LS_FILES`;
 *  - `archive --format=tar.gz HEAD`: prints the bytes of the file `FAKE_GIT_ARCHIVE`;
 * and exits `FAKE_GIT_FAIL` (writing `fatal: scripted failure`) when that variable is set. Every call is appended to
 * `<FAKE_GIT_DIR>/git-calls.log` as a JSON array of its arguments.
 */
const FAKE_GIT_SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.FAKE_GIT_DIR, "git-calls.log"), JSON.stringify(argv) + "\n");
if (process.env.FAKE_GIT_FAIL) {
  process.stderr.write("fatal: scripted failure\n");
  process.exit(Number(process.env.FAKE_GIT_FAIL));
}
if (argv[0] === "ls-files") {
  process.stdout.write(fs.readFileSync(process.env.FAKE_GIT_LS_FILES), () => process.exit(0));
} else if (argv[0] === "archive") {
  process.stdout.write(fs.readFileSync(process.env.FAKE_GIT_ARCHIVE), () => process.exit(0));
} else {
  process.stderr.write("unscripted git command: " + argv.join(" ") + "\n");
  process.exit(99);
}
`;

/** Install the stand-in `git` as `<binDir>/git` (executable; the shebang is the running Node, so it runs with a PATH of its own directory alone). */
export function installFakeGit(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, "git");
  writeFileSync(script, `#!${process.execPath}\n${FAKE_GIT_SOURCE}`, "utf8");
  chmodSync(script, 0o755);
}

/** The arguments of every call the stand-in `git` received, in order. */
export function fakeGitCalls(directory: string): string[][] {
  const log = path.join(directory, "git-calls.log");
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as string[])
    : [];
}

/**
 * An ES module a child process loads with `--import`, replacing `globalThis.fetch` with an answer from a file, so that the script's
 * own call (its URL, built from `GITHUB_REPOSITORY` and `GITHUB_SHA`) is exercised and no network is reached. The answer is a real
 * `Response`:
 *  - `FAKE_FETCH_STATUS` (default 200) is the status; for 200 the body is the bytes of `FAKE_FETCH_FILE`;
 *  - `FAKE_FETCH_STATUS=network` makes the call reject with the `TypeError("fetch failed")` that fetch rejects with when no connection is made;
 * and every requested URL is appended to `<FAKE_GIT_DIR>/fetch-calls.log`.
 */
const FETCH_PRELOAD_SOURCE = `import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

globalThis.fetch = async (url) => {
  appendFileSync(path.join(process.env.FAKE_GIT_DIR, "fetch-calls.log"), String(url) + "\\n");
  const status = process.env.FAKE_FETCH_STATUS ?? "200";
  if (status === "network") throw new TypeError("fetch failed");
  const code = Number(status);
  if (code !== 200) return new Response("not served", { status: code });
  return new Response(readFileSync(process.env.FAKE_FETCH_FILE), { status: 200 });
};
`;

/** Write the fetch stand-in into `directory` and return the `--import` option that loads it. */
export function writeFetchPreload(directory: string): string {
  const file = path.join(directory, "fetch-preload.mjs");
  writeFileSync(file, FETCH_PRELOAD_SOURCE, "utf8");
  return `--import=${new URL(`file://${file}`).href}`;
}

/** The URLs the fetch stand-in was asked for, in order. */
export function fakeFetchCalls(directory: string): string[] {
  const log = path.join(directory, "fetch-calls.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : [];
}
