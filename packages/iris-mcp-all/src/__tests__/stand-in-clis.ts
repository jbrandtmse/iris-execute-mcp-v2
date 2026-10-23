/**
 * Scripted stand-ins for the command-line tools the release script runs (`npm`, `git`, `vsce`, `ovsx`), on the mechanism of
 * `fake-docker.ts`: a Node script of the tool's name in a directory that the test makes the ONLY entry of the script's PATH, so no real
 * `npm publish`, `git push` or store upload can run. A stand-in never starts a process and never touches the network.
 *
 * What a stand-in does, per call:
 *  - It appends `{ seq, pid, argv, cwd, env, stdin, userconfig? }` to `<state>/<name>.calls.log`. `seq` is a clock that all stand-ins of one
 *    directory share, so the order of calls across tools can be read back. `env` is the full environment the tool was started with, so a
 *    test can prove that a secret never reached it. When an argument is `--userconfig <file>`, the file's mode and text AT THE TIME OF
 *    THE CALL are recorded too (the release deletes it afterwards).
 *  - It answers from `<state>/<name>.script.json`, a list of rules `{ match, stdout?, stderr?, status?, sleepMs?, effects? }`. The first
 *    rule whose `match` (a list of strings, each equal to the argument at its position, `*` for any, or `~text` for one that contains
 *    `text`) is a prefix of the arguments answers; with no rule the call prints nothing and exits 0. `effects` are `{ mkdir: <path> }` and `{ write: <path>, text }`, where the
 *    path may be `$LAST` (the last argument). `sleepMs` blocks before the answer, for the tests of a signal.
 *  - The key file of the IPM deploy key is recorded at the call time too: when `GIT_SSH_COMMAND` names a file after `-i`, its mode and
 *    text are in `sshKey`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One rule of a stand-in's script. */
export interface StandInRule {
  /** The arguments the call must start with; `*` matches any argument. */
  match: string[];
  stdout?: string;
  stderr?: string;
  status?: number;
  sleepMs?: number;
  effects?: Array<{ mkdir: string } | { write: string; text: string }>;
}

/** One recorded call. */
export interface StandInCall {
  seq: number;
  tool: string;
  /** The process id of the stand-in, so that a test can tell whether the script killed it. */
  pid: number;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  userconfig?: { path: string; mode: string; text: string };
  sshKey?: { path: string; mode: string; text: string };
}

const SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.STAND_IN_DIR;
const tool = process.env.STAND_IN_TOOL || path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const clock = path.join(dir, "clock");
const seq = (fs.existsSync(clock) ? Number(fs.readFileSync(clock, "utf8")) : 0) + 1;
fs.writeFileSync(clock, String(seq));

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function snapshot(file) {
  try {
    return { path: file, mode: (fs.statSync(file).mode & 0o777).toString(8), text: fs.readFileSync(file, "utf8") };
  } catch {
    return undefined;
  }
}
const call = { seq, tool, pid: process.pid, argv, cwd: process.cwd(), env: { ...process.env }, stdin: readStdin() };
const configIndex = argv.indexOf("--userconfig");
if (configIndex >= 0 && argv[configIndex + 1]) call.userconfig = snapshot(argv[configIndex + 1]);
const key = /-i (\S+)/.exec(process.env.GIT_SSH_COMMAND || "");
if (key) call.sshKey = snapshot(key[1]);
fs.appendFileSync(path.join(dir, tool + ".calls.log"), JSON.stringify(call) + "\n");

const scriptFile = path.join(dir, tool + ".script.json");
const rules = fs.existsSync(scriptFile) ? JSON.parse(fs.readFileSync(scriptFile, "utf8")) : [];
const matches = (expected, actual) => expected === "*" || (expected.startsWith("~") ? String(actual || "").includes(expected.slice(1)) : actual === expected);
const rule = rules.find((candidate) => candidate.match.every((expected, index) => matches(expected, argv[index])));
if (rule) {
  const last = argv[argv.length - 1];
  for (const effect of rule.effects || []) {
    if (effect.mkdir) fs.mkdirSync(effect.mkdir.replace("$LAST", last), { recursive: true });
    if (effect.write) {
      const target = effect.write.replace("$LAST", last);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, effect.text);
    }
  }
  const finish = () => {
    if (rule.stdout) process.stdout.write(rule.stdout);
    if (rule.stderr) process.stderr.write(rule.stderr);
    process.exit(rule.status || 0);
  };
  if (rule.sleepMs) setTimeout(finish, rule.sleepMs);
  else finish();
} else {
  process.exit(0);
}
`;

/** The stand-ins installed in a directory. */
export interface StandIns {
  /** The directory that holds the stand-ins: the whole PATH of the script under test. */
  binDir: string;
  /** The directory of the calls logs and scripts; the `STAND_IN_DIR` value. */
  dir: string;
  /** Install the stand-in `name` into another directory (the extension's `node_modules/.bin`, for `vsce` and `ovsx`). */
  installInto: (name: string, binDir: string) => void;
  /** The calls of one tool so far, in order. */
  calls: (name: string) => StandInCall[];
  /** The calls of all the tools so far, in the order they were made. */
  allCalls: () => StandInCall[];
  /** Replace the script of one tool. */
  script: (name: string, rules: StandInRule[]) => void;
}

/**
 * Install the stand-ins named in `names` under `root`: `root/bin/<name>` (executable) and `root/state/`. The shebang is the absolute
 * path of the running Node, so a stand-in runs with a PATH that holds nothing but its own directory. The environment that starts the
 * script under test needs `STAND_IN_DIR` ({@link StandIns.dir}).
 */
export function installStandIns(root: string, names: readonly string[]): StandIns {
  const binDir = path.join(root, "bin");
  const dir = path.join(root, "state");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const install = (name: string, into: string): void => {
    mkdirSync(into, { recursive: true });
    const file = path.join(into, name);
    writeFileSync(file, `#!${process.execPath}\nprocess.env.STAND_IN_TOOL = process.env.STAND_IN_TOOL || ${JSON.stringify(name)};\n${SOURCE}`, "utf8");
    chmodSync(file, 0o755);
  };
  for (const name of names) install(name, binDir);
  const logOf = (name: string): string => path.join(dir, `${name}.calls.log`);
  const read = (name: string): StandInCall[] =>
    existsSync(logOf(name))
      ? readFileSync(logOf(name), "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as StandInCall)
      : [];
  return {
    binDir,
    dir,
    installInto: install,
    calls: read,
    allCalls: () => [...names, "vsce", "ovsx"].filter((name, index, all) => all.indexOf(name) === index).flatMap(read).sort((a, b) => a.seq - b.seq),
    script: (name, rules) => writeFileSync(path.join(dir, `${name}.script.json`), JSON.stringify(rules), "utf8"),
  };
}
