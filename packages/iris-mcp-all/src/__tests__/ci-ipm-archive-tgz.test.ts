/**
 * Story 42.4 rework 1 ([CI]) -- `readTgz` and `extractEntries` of `scripts/lib/ipm-archive.mjs`, which the archive phase of
 * `scripts/ci-ipm-archive.mjs` uses in place of `tar tzf` and `tar xzf`, so that the proof depends on no `tar` or `gzip` binary (on
 * Linux, GNU tar execs an external `gzip`, and the scripted run's PATH holds none).
 *
 *  - THE HOST TAR AS THE ORACLE (Rule #36). For each format the host `tar` can write (default, ustar, pax, gnu, v7), over the staged real
 *    embed plus a file with every byte value, an empty file, a file of 513 bytes and, except for v7, paths over 100 characters, the
 *    members `readTgz` returns equal `tar tzf`, and every file's bytes equal what `tar xzf` extracts and what `extractEntries` writes.
 *  - A REAL IPM ARCHIVE. `fixtures/ipm-real-package.tgz` is what IPM's `package` wrote for a two-class module (one class preloaded),
 *    captured byte for byte on a throwaway `iris-community:2026.2` container; its members and sizes are what `tar tzvf` printed for it.
 *  - HAND-BUILT ARCHIVES, for what a host `tar` is not made to write: a pax `path` and `size` override, a GNU `L` long name, a base-256
 *    size, a pax `g` header, no end marker, a typeflag-5 name without a slash, and an archive built the way IPM's writer
 *    (`%IPM.Utils.FileBinaryTar`) builds one, which `archiveProblems` accepts over the real embed with no host `tar` at all.
 *  - THE REFUSALS: not gzip, a bad checksum, a member cut short, a `..` name and an absolute name.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { archiveProblems, extractEntries, manifestDeclarations, readTgz, stageModule } from "../../../../scripts/lib/ipm-archive.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { filesUnder, realEmbed, tarGz } from "./ipm-archive-fixture";

const scratch: string[] = [];
function scratchDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ci-ipm-archive-tgz-"));
  scratch.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// -- a tar writer for hand-built archives ------------------------------------------------------

const BLOCK = 512;
const END_MARKER = Buffer.alloc(2 * BLOCK);
const text = (value: string): Buffer => Buffer.from(value, "utf8");

interface HeaderSpec {
  /** At most 100 bytes: a longer path goes in `prefix`, a pax `path` record or a GNU `L` member. */
  name: string;
  /** The data size, written as octal digits (the default is 0). */
  size?: number;
  /** The raw 12-byte size field, in place of `size`. */
  sizeField?: Buffer;
  typeflag?: string;
  prefix?: string;
  /** `posix` writes `ustar\0` and `00` (the default), `gnu` writes `ustar  \0`, `none` writes no magic (v7). */
  magic?: "posix" | "gnu" | "none";
  /** Write every numeric field as IPM's writer does: octal digits and a blank, in a field padded with NULs. */
  ipm?: boolean;
  /** Store the checksum as the sum of signed bytes, as some historic tars do. */
  signedChecksum?: boolean;
}

function header(spec: HeaderSpec): Buffer {
  const block = Buffer.alloc(BLOCK);
  const end = spec.ipm === true ? " " : "\u0000";
  const number = (value: number, digits: number): string => `${value.toString(8).padStart(digits, "0")}${end}`;
  block.write(spec.name, 0, 100, "utf8");
  block.write(number(0o644, 6), 100, "latin1");
  block.write(number(0, 6), 108, "latin1");
  block.write(number(0, 6), 116, "latin1");
  if (spec.sizeField !== undefined) spec.sizeField.copy(block, 124);
  else block.write(number(spec.size ?? 0, 11), 124, "latin1");
  block.write(number(0, 11), 136, "latin1");
  block.fill(0x20, 148, 156);
  block.write(spec.typeflag ?? "0", 156, "latin1");
  const magic = spec.magic ?? "posix";
  if (magic === "posix") block.write("ustar\u0000" + "00", 257, "latin1");
  if (magic === "gnu") block.write("ustar  \u0000", 257, "latin1");
  if (spec.prefix !== undefined) block.write(spec.prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += spec.signedChecksum === true && byte > 127 ? byte - 256 : byte;
  block.write(spec.ipm === true ? `${sum.toString(8).padStart(6, "0")} \u0000` : `${sum.toString(8).padStart(6, "0")}\u0000 `, 148, "latin1");
  return block;
}

/** Data padded with NULs to a whole number of blocks. */
function padded(data: Buffer): Buffer {
  const rest = data.length % BLOCK;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - rest)]);
}

/** A header and its padded data; the header's size is the data's length unless `spec` sets one. */
function member(spec: HeaderSpec, data: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([header({ size: data.length, ...spec }), padded(data)]);
}

/** One pax record, `<length> <key>=<value>\n`, whose length counts its own digits and is in bytes. */
function paxRecord(key: string, value: string): Buffer {
  const rest = text(` ${key}=${value}\n`);
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
  return Buffer.concat([Buffer.from(String(length), "latin1"), rest]);
}

/** The raw 12-byte GNU base-256 size field of `value`. */
function base256(value: number): Buffer {
  const field = Buffer.alloc(12);
  field[0] = 0x80;
  let rest = value;
  for (let index = 11; index >= 1 && rest > 0; index -= 1) {
    field[index] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return field;
}

function tgz(parts: Buffer[], { end = true }: { end?: boolean } = {}): Buffer {
  return gzipSync(Buffer.concat(end ? [...parts, END_MARKER] : parts));
}

const read = (parts: Buffer[], options?: { end?: boolean }) => readTgz(tgz(parts, options)).map((entry) => ({ name: entry.name, type: entry.type, data: entry.data.toString("utf8") }));

// -- the host tar as the oracle ----------------------------------------------------------------

const POSIX_MAGIC = Buffer.from("ustar\u000000", "latin1");
const GNU_MAGIC = Buffer.from("ustar  \u0000", "latin1");

interface FormatSpec {
  name: string;
  /** Spellings of the option, tried in turn (GNU tar and bsdtar name some formats differently). */
  spellings: string[][];
  /** Whether the first header of an archive in the format carries this format's mark: the option was honored, not ignored. */
  honored?: (firstHeader: Buffer) => boolean;
  /** Whether the format holds a path of over 100 characters (v7 does not). */
  longPaths: boolean;
}

const FORMATS: FormatSpec[] = [
  { name: "default", spellings: [[]], longPaths: true },
  { name: "ustar", spellings: [["--format=ustar"]], honored: (header) => header.subarray(257, 265).equals(POSIX_MAGIC), longPaths: true },
  { name: "pax", spellings: [["--format=pax"]], longPaths: true },
  { name: "gnu", spellings: [["--format=gnu"], ["--format=gnutar"]], honored: (header) => header.subarray(257, 265).equals(GNU_MAGIC), longPaths: true },
  { name: "v7", spellings: [["--format=v7"], ["--format=v7tar"], ["--format=oldtar"]], honored: (header) => header.subarray(257, 263).every((byte) => byte === 0), longPaths: false },
];

/** The formats this host's `tar` can write, with the option that writes each (probed on a one-file directory). */
function hostFormats(): Array<FormatSpec & { flags: string[] }> {
  const probe = mkdtempSync(path.join(tmpdir(), "ci-ipm-archive-probe-"));
  const out = mkdtempSync(path.join(tmpdir(), "ci-ipm-archive-probe-out-"));
  try {
    writeFileSync(path.join(probe, "a.txt"), "a");
    const formats: Array<FormatSpec & { flags: string[] }> = [];
    for (const format of FORMATS) {
      for (const flags of format.spellings) {
        const archive = path.join(out, `${format.name}.tgz`);
        if (tarGz(archive, probe, flags) !== 0) continue;
        if (format.honored !== undefined && !format.honored(gunzipSync(readFileSync(archive)).subarray(0, BLOCK))) continue;
        formats.push({ ...format, flags });
        break;
      }
    }
    return formats;
  } finally {
    rmSync(probe, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

const HOST_FORMATS = hostFormats();

/** Components of 40 characters, so that a path over 100 characters splits into a ustar prefix and a name. */
const LONG_PATHS = [
  `src/cls/ExecuteMCPv2/${"a".repeat(40)}/${"b".repeat(40)}/Long.cls`,
  `src/cls/ExecuteMCPv2/${"c".repeat(40)}/${"d".repeat(40)}/${"e".repeat(40)}/${"f".repeat(40)}/Deep.cls`,
];

describe("readTgz and extractEntries against the host tar (Rule #36)", () => {
  it("the host tar can write at least the default and the ustar formats, so the oracle compares something, and every format when it is GNU tar or bsdtar", () => {
    const names = HOST_FORMATS.map((format) => format.name);
    expect(names).toEqual(expect.arrayContaining(["default", "ustar"]));
    const version = spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout ?? "";
    if (/GNU tar|bsdtar/.test(version)) expect(names, version.split("\n")[0]).toEqual(FORMATS.map((format) => format.name));
  });

  describe.each(HOST_FORMATS.map((format) => [format.name, format] as const))("the %s format", (_name, format) => {
    it("returns the members `tar tzf` lists, and every file's bytes equal what `tar xzf` and `extractEntries` write", () => {
      const stage = scratchDir();
      stageModule(stage, realEmbed());
      const everyByte = Buffer.alloc(1024);
      for (let index = 0; index < everyByte.length; index += 1) everyByte[index] = index % 256;
      writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/every-byte.bin"), everyByte);
      writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/empty.bin"), "");
      writeFileSync(path.join(stage, "src/cls/ExecuteMCPv2/over-a-block.bin"), Buffer.alloc(513, 0x7a));
      if (format.longPaths) {
        for (const long of LONG_PATHS) {
          mkdirSync(path.dirname(path.join(stage, long)), { recursive: true });
          writeFileSync(path.join(stage, long), `Class Long.${long.length}\n`);
        }
      }
      const archive = path.join(scratchDir(), "oracle.tgz");
      expect(tarGz(archive, stage, format.flags)).toBe(0);

      const listed = spawnSync("tar", ["tzf", archive], { encoding: "utf8" });
      expect(listed.status, listed.stderr).toBe(0);
      const entries = readTgz(readFileSync(archive));
      expect(entries.map((entry) => entry.name)).toEqual(listed.stdout.split("\n").filter((line) => line !== ""));
      expect(entries.filter((entry) => entry.type === "file").length, "a staged tree of files").toBeGreaterThan(35);
      if (format.longPaths) {
        for (const long of LONG_PATHS) expect(entries.map((entry) => entry.name).some((name) => name.endsWith(long)), long).toBe(true);
      }

      const hostDirectory = scratchDir();
      expect(spawnSync("tar", ["xzf", archive, "-C", hostDirectory]).status).toBe(0);
      const ownDirectory = scratchDir();
      extractEntries(entries, ownDirectory);
      const files = filesUnder(hostDirectory);
      expect(filesUnder(ownDirectory)).toEqual(files);
      expect(files).toEqual(filesUnder(stage));
      for (const file of files) {
        const expected = readFileSync(path.join(stage, file));
        expect(readFileSync(path.join(hostDirectory, file)).equals(expected), `tar xzf ${file}`).toBe(true);
        expect(readFileSync(path.join(ownDirectory, file)).equals(expected), `extractEntries ${file}`).toBe(true);
      }
    });
  });
});

// -- what a host tar is not made to write --------------------------------------------------------

describe("readTgz over hand-built archives", () => {
  it("reads the path of a pax x header in bytes, not characters, over the short name of the member", () => {
    const long = `src/cls/caf\u00e9/${"d".repeat(120)}/Long.cls`;
    const records = Buffer.concat([paxRecord("path", long), paxRecord("mtime", "1.5")]);

    expect(read([member({ name: "PaxHeader/short", typeflag: "x" }, records), member({ name: "short.cls" }, text("Class A {}\n"))])).toEqual([
      { name: long, type: "file", data: "Class A {}\n" },
    ]);
  });

  it("reads the size of a pax x header over a header size of 0, and applies a pax record to the next member only", () => {
    const data = text("x".repeat(700));
    const sized = Buffer.concat([
      member({ name: "PaxHeader/sized", typeflag: "x" }, paxRecord("size", String(data.length))),
      header({ name: "sized.bin", size: 0 }),
      padded(data),
      member({ name: "plain.txt" }, text("plain")),
    ]);

    expect(read([sized])).toEqual([
      { name: "sized.bin", type: "file", data: data.toString("utf8") },
      { name: "plain.txt", type: "file", data: "plain" },
    ]);
  });

  it("reads a GNU L long name over the truncated name of the member that follows", () => {
    const long = `${"seg/".repeat(40)}Gnu.cls`;
    const longName = member({ name: "././@LongLink", typeflag: "L", magic: "gnu" }, Buffer.concat([text(long), Buffer.alloc(1)]));

    expect(read([longName, member({ name: long.slice(0, 99), magic: "gnu" }, text("gnu\n")), member({ name: "next.txt", magic: "gnu" }, text("n"))])).toEqual([
      { name: long, type: "file", data: "gnu\n" },
      { name: "next.txt", type: "file", data: "n" },
    ]);
  });

  it("reads a GNU base-256 size, and octal sizes with leading blanks, a trailing blank or NULs, or a stop at the first non-octal byte", () => {
    const big = Buffer.alloc(1543, 0x61);
    const blanks = Buffer.from("       12\u0000\u0000\u0000", "latin1");
    const stops = Buffer.from("000000000128", "latin1");

    expect(
      read([
        member({ name: "base256.bin", sizeField: base256(5) }, text("12345")),
        member({ name: "base256-big.bin", sizeField: base256(big.length) }, big),
        member({ name: "blanks.txt", sizeField: blanks }, text("0123456789")),
        member({ name: "stops.txt", sizeField: stops }, text("0123456789")),
        member({ name: "ipm.txt", ipm: true }, text("ipm")),
      ]).map((entry) => [entry.name, entry.data.length]),
    ).toEqual([
      ["base256.bin", 5],
      ["base256-big.bin", 1543],
      ["blanks.txt", 10],
      ["stops.txt", 10],
      ["ipm.txt", 3],
    ]);
  });

  it("consumes pax g and GNU K headers and ignores them: a global path or size record changes no member", () => {
    const global = member({ name: "pax_global_header", typeflag: "g" }, Buffer.concat([paxRecord("path", "GLOBAL/IGNORED"), paxRecord("size", "999")]));
    const link = member({ name: "././@LongLink", typeflag: "K", magic: "gnu" }, text("a/link/target\u0000"));

    expect(read([global, link, member({ name: "kept.txt" }, text("kept"))])).toEqual([{ name: "kept.txt", type: "file", data: "kept" }]);
  });

  it("reads an archive that has no end marker as it reads one that has", () => {
    const parts = [member({ name: "a.txt" }, text("a")), member({ name: "b.bin" }, Buffer.alloc(BLOCK, 0x62))];

    expect(read(parts, { end: false })).toEqual(read(parts, { end: true }));
    expect(read(parts, { end: false }).map((entry) => entry.name)).toEqual(["a.txt", "b.bin"]);
  });

  it("stops at the first all-zero block: nothing after it is a member", () => {
    expect(read([member({ name: "a.txt" }, text("a")), END_MARKER, member({ name: "after.txt" }, text("after"))], { end: false }).map((entry) => entry.name)).toEqual(["a.txt"]);
  });

  it("names a typeflag-5 member with no slash as a directory ending in a slash, and a regular file that ends in one as well", () => {
    expect(read([member({ name: "somedir", typeflag: "5" }), member({ name: "with/slash/", typeflag: "5" }), member({ name: "looks-like/", typeflag: "0" })])).toEqual([
      { name: "somedir/", type: "directory", data: "" },
      { name: "with/slash/", type: "directory", data: "" },
      { name: "looks-like/", type: "directory", data: "" },
    ]);
  });

  it("reports links and other types as `other` with no data, and a link's size field does not swallow the next member", () => {
    expect(
      read([
        header({ name: "hard", typeflag: "1", size: 7 }),
        header({ name: "soft", typeflag: "2", size: 7 }),
        member({ name: "fifo", typeflag: "6" }),
        member({ name: "after.txt" }, text("after")),
      ]),
    ).toEqual([
      { name: "hard", type: "other", data: "" },
      { name: "soft", type: "other", data: "" },
      { name: "fifo", type: "other", data: "" },
      { name: "after.txt", type: "file", data: "after" },
    ]);
  });

  it("joins a POSIX prefix and a name with one slash, and reads the prefix bytes of a GNU or v7 header as no prefix", () => {
    expect(
      read([
        member({ name: "c.txt", prefix: "a/b" }),
        member({ name: "c.txt", prefix: "a/b/" }),
        member({ name: "c.txt", prefix: "a//b/" }),
        member({ name: "c.txt", prefix: "not/a/prefix", magic: "gnu" }),
        member({ name: "c.txt", prefix: "not/a/prefix", magic: "none" }),
      ]).map((entry) => entry.name),
    ).toEqual(["a/b/c.txt", "a/b/c.txt", "a//b/c.txt", "c.txt", "c.txt"]);
  });

  it("accepts a checksum stored as the sum of signed bytes as well as the unsigned one", () => {
    const name = "caf\u00e9.txt";

    expect(read([member({ name }, text("u")), member({ name, signedChecksum: true }, text("s"))])).toEqual([
      { name, type: "file", data: "u" },
      { name, type: "file", data: "s" },
    ]);
  });
});

/**
 * An archive built the way `%IPM.Utils.FileBinaryTar` builds one: a prefix that ends in a slash (and joins `src/` and `cls` with a doubled
 * one), a name of at most 99 characters, octal fields that end in a blank, `ustar` and `00`, each file's data padded to a block, and no end
 * marker.
 */
function ipmArchive(stage: string): Buffer {
  const parts: Buffer[] = [];
  const walk = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = relative.replace(/^src\//, "src//");
      if (entry.isDirectory()) {
        parts.push(header({ name: entry.name, prefix, typeflag: "5", ipm: true }));
        walk(path.join(directory, entry.name), `${relative}${entry.name}/`);
      } else {
        parts.push(member({ name: entry.name, prefix, ipm: true }, readFileSync(path.join(directory, entry.name))));
      }
    }
  };
  walk(stage, "");
  return tgz(parts, { end: false });
}

describe("an archive built the way IPM's writer builds one", () => {
  it("is read, extracted and accepted by archiveProblems over the real embed, with no host tar", () => {
    const embed = realEmbed();
    const stage = scratchDir();
    stageModule(stage, embed);
    const entries = readTgz(ipmArchive(stage));

    expect(entries.map((entry) => entry.name)).toContain("src//cls/ExecuteMCPv2/Utils.cls");
    expect(entries.map((entry) => entry.name)).toContain("preload/src/cls/ExecuteMCPv2/InstallGuard.cls");
    expect(entries.filter((entry) => entry.type === "file")).toHaveLength(embed.classes.size + 2);
    const extracted = scratchDir();
    extractEntries(entries, extracted);

    expect(filesUnder(extracted)).toEqual(filesUnder(stage));
    expect(archiveProblems(entries.map((entry) => entry.name), extracted, embed)).toEqual([]);
  });
});

// -- a real IPM archive -------------------------------------------------------------------------------

/**
 * What IPM's `package` wrote for a module of two classes, one of them preloaded: `fixtures/ipm-real-package.tgz` (sha-256
 * 354ed5c06a5b257d17693a702e417f956a6b8f7f3a17b32376deb3758f152dd8), captured byte for byte on a throwaway iris-community:2026.2
 * container during the Story 42.4 plan probes. The expected members and sizes are what `tar tzvf` (bsdtar 3.5.3) printed for it. IPM
 * writes a directory as typeflag 5 without a trailing slash and ends the archive with no end marker.
 */
const REAL_ARCHIVE = path.join(REPO_ROOT, "packages", "iris-mcp-all", "src", "__tests__", "fixtures", "ipm-real-package.tgz");
const REAL_MEMBERS: Array<[string, "file" | "directory", number]> = [
  ["preload/", "directory", 0],
  ["preload/src/", "directory", 0],
  ["preload/src/cls/", "directory", 0],
  ["preload/src/cls/ProbeMod/", "directory", 0],
  ["preload/src/cls/ProbeMod/Guard.cls", "file", 950],
  ["src/", "directory", 0],
  ["src/cls/", "directory", 0],
  ["src/cls/ProbeMod/", "directory", 0],
  ["src/cls/ProbeMod/A.cls", "file", 179],
  ["module.xml", "file", 508],
];

describe("readTgz over a real IPM package archive", () => {
  it("reads the ten members IPM wrote, in order, with the sizes tar printed for them", () => {
    const entries = readTgz(readFileSync(REAL_ARCHIVE));

    expect(entries.map((entry) => [entry.name, entry.type, entry.data.length])).toEqual(REAL_MEMBERS);
  });

  it("agrees with the host tar, up to the slashes a tar leaves out or doubles: the same members, and the same bytes in every file", () => {
    const entries = readTgz(readFileSync(REAL_ARCHIVE));
    const listed = spawnSync("tar", ["tzf", REAL_ARCHIVE], { encoding: "utf8" });
    expect(listed.status, listed.stderr).toBe(0);
    const normalize = (name: string): string => name.replace(/\/\/+/g, "/").replace(/\/$/, "");
    expect(entries.map((entry) => normalize(entry.name))).toEqual(listed.stdout.split("\n").filter((line) => line !== "").map(normalize));

    const hostDirectory = scratchDir();
    expect(spawnSync("tar", ["xzf", REAL_ARCHIVE, "-C", hostDirectory]).status).toBe(0);
    const ownDirectory = scratchDir();
    extractEntries(entries, ownDirectory);
    const files = filesUnder(hostDirectory);
    expect(filesUnder(ownDirectory)).toEqual(files);
    expect(files).toEqual(["module.xml", "preload/src/cls/ProbeMod/Guard.cls", "src/cls/ProbeMod/A.cls"]);
    for (const file of files) expect(readFileSync(path.join(ownDirectory, file)).equals(readFileSync(path.join(hostDirectory, file))), file).toBe(true);
  });

  it("carries a manifest that manifestDeclarations reads: the preloaded resource, the other resource and the Check invoke with CheckStatus", () => {
    const manifest = readTgz(readFileSync(REAL_ARCHIVE)).find((entry) => entry.name === "module.xml");
    const declared = manifestDeclarations(manifest?.data.toString("utf8") ?? "");

    expect(declared.name).toBe("probe-mod");
    expect(declared.resources).toEqual([
      { name: "ProbeMod.Guard.CLS", preload: true },
      { name: "ProbeMod.A.CLS", preload: false },
    ]);
    expect(declared.invokes[0]).toMatchObject({ class: "ProbeMod.Guard", method: "Check", phase: "Initialize", when: "After", checkStatus: true });
  });
});

// -- the refusals ---------------------------------------------------------------------------

describe("readTgz refusals", () => {
  it("refuses a file that is not gzip, an uncompressed tar included, naming it", () => {
    expect(() => readTgz(text("this is not a gzip file"))).toThrow(/not a gzip file/);
    expect(() => readTgz(Buffer.concat([member({ name: "a.txt" }, text("a")), END_MARKER]))).toThrow(/not a gzip file/);
    expect(() => readTgz(Buffer.alloc(0))).toThrow(/not a gzip file/);
  });

  it("refuses a gzip stream that is cut short or damaged", () => {
    const good = tgz([member({ name: "a.txt" }, text("a".repeat(2000)))]);

    expect(() => readTgz(good.subarray(0, Math.floor(good.length / 2)))).toThrow(/gzip stream is damaged/);
  });

  it("refuses a header whose checksum is wrong, naming the member and both sums", () => {
    const block = header({ name: "tampered.txt" });
    block[0] ^= 0x01;

    expect(() => readTgz(tgz([block, padded(Buffer.alloc(0))]))).toThrow(/has a bad checksum: it stores \d+ and the header sums to \d+/);
    const zeroed = header({ name: "zeroed.txt" });
    zeroed.fill(0x30, 148, 154);
    expect(() => readTgz(tgz([zeroed]))).toThrow(/bad checksum/);
  });

  it("refuses a member whose data is cut short, and a header that is cut short", () => {
    const short = Buffer.concat([header({ name: "short.bin", size: 1000 }), Buffer.alloc(100, 0x61)]);

    expect(() => readTgz(tgz([short], { end: false }))).toThrow(/"short\.bin" is cut short: its header says 1000 byte\(s\) and the archive holds 100/);
    expect(() => readTgz(tgz([member({ name: "a.txt" }, text("a")), header({ name: "b.txt" }).subarray(0, 300)], { end: false }))).toThrow(/cut short inside the header/);
  });

  it("refuses a pax header with a malformed record", () => {
    expect(() => readTgz(tgz([member({ name: "PaxHeader/x", typeflag: "x" }, text("99 path=short\n")), member({ name: "a.txt" }, text("a"))]))).toThrow(/malformed record/);
    expect(() => readTgz(tgz([member({ name: "PaxHeader/x", typeflag: "x" }, text("x path=short\n")), member({ name: "a.txt" }, text("a"))]))).toThrow(/malformed record/);
  });
});

describe("extractEntries", () => {
  const file = (name: string, data = "x") => ({ name, type: "file", data: text(data) });

  it("writes files and directories under the directory, collapsing repeated slashes and a leading ./, and skips `other` members", () => {
    const target = scratchDir();

    const written = extractEntries(
      [
        { name: "./", type: "directory", data: Buffer.alloc(0) },
        { name: "./src//cls/", type: "directory", data: Buffer.alloc(0) },
        file("./src//cls/A.cls", "a"),
        file("deep/er/B.cls", "b"),
        { name: "link", type: "other", data: Buffer.alloc(0) },
      ],
      target,
    );

    expect(filesUnder(target)).toEqual(["deep/er/B.cls", "src/cls/A.cls"]);
    expect(readFileSync(path.join(target, "src/cls/A.cls"), "utf8")).toBe("a");
    expect(written).toEqual({ files: ["src/cls/A.cls", "deep/er/B.cls"], directories: ["src/cls"] });
  });

  it.each([
    ["a .. segment", "../evil.txt", /has a "\.\." segment, so it is not extracted/],
    ["a .. segment in the middle", "a/../../evil.txt", /has a "\.\." segment, so it is not extracted/],
    ["a .. segment as the last one", "a/b/..", /has a "\.\." segment, so it is not extracted/],
    ["an absolute path", "/tmp/evil.txt", /has an absolute path, so it is not extracted/],
    ["an absolute path with a doubled slash", "//tmp/evil.txt", /has an absolute path, so it is not extracted/],
    ["a drive letter", "C:/evil.txt", /has an absolute path, so it is not extracted/],
  ])("refuses %s, and writes nothing, not even the members before it", (_label, name, message) => {
    const target = scratchDir();

    expect(() => extractEntries([file("good.txt"), file(name)], target)).toThrow(message);
    expect(readdirSync(target)).toEqual([]);
  });

  it("extracts a member whose name merely starts with two dots", () => {
    const target = scratchDir();

    extractEntries([file("..hidden")], target);

    expect(filesUnder(target)).toEqual(["..hidden"]);
  });
});
