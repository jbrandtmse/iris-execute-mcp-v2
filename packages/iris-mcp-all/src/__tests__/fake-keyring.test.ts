/**
 * `scripts/lib/fake-keyring.mjs` and its preload (Story 44.6): the file-backed fake of `@napi-rs/keyring` that the
 * credential process gates install through NODE_OPTIONS.
 *
 * The fake's method names are pinned to the INSTALLED `index.d.ts` (Rule #54): a fake that grew a method the real module
 * lacks, or kept one a new version renamed, would make every gate green over an API that does not exist. The preload is
 * proven in a fresh Node process: the specifier resolves to the fake and a stored entry lands in the scratch file.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAKE_KEYRING_API } from "../../../../scripts/lib/fake-keyring.mjs";
import { inheritedEnv } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PRELOAD_URL = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs")).href;

/** The installed `@napi-rs/keyring` type declarations, or `undefined` when the package is not installed. */
function installedDeclarations(): string | undefined {
  const pnpmDir = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  const dir = readdirSync(pnpmDir).find((name) => name.startsWith("@napi-rs+keyring@"));
  if (dir === undefined) return undefined;
  const file = path.join(pnpmDir, dir, "node_modules", "@napi-rs", "keyring", "index.d.ts");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "fake-keyring-"));
});
afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

function runInFreshNode(script: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [`--import=${PRELOAD_URL}`, "--input-type=module", "-e", script], {
    env: { ...inheritedEnv(), ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("the fake keyring's surface is the installed @napi-rs/keyring's", () => {
  it("every method the fake implements is declared by the installed index.d.ts, with the shapes the fake returns", (ctx) => {
    const declarations = installedDeclarations();
    if (declarations === undefined) {
      if (process.env.CI === "true") throw new Error("@napi-rs/keyring is not installed, so the fake cannot be pinned to it.");
      return ctx.skip();
    }
    const entryClass = declarations.slice(declarations.indexOf("export declare class Entry"));
    const entryBody = entryClass.slice(0, entryClass.indexOf("\n}"));
    for (const method of FAKE_KEYRING_API.entryMethods) {
      expect(entryBody, `Entry.${method}`).toMatch(new RegExp(`\\n\\s+${method}\\(`));
    }
    expect(entryBody).toMatch(/\n\s+setPassword\(password: string\): void/);
    expect(entryBody).toMatch(/\n\s+getPassword\(\): string \| null/);
    expect(entryBody).toMatch(/\n\s+deleteCredential\(\): boolean/);
    expect(entryBody).toMatch(/\n\s+deletePassword\(\): boolean/);
    expect(entryBody).toMatch(/constructor\(service: string, username: string\)/);
    for (const fn of FAKE_KEYRING_API.functions) {
      expect(declarations, fn).toContain(`export declare function ${fn}(service: string`);
    }
    expect(declarations).toMatch(/export interface Credential \{\s+account: string\s+password: string\s+\}/);
  });
});

describe("the preload routes @napi-rs/keyring to the fake in a fresh process", () => {
  it("stores, reads, lists and deletes through the scratch file", () => {
    const file = path.join(scratch, "store.json");
    const script = `
      const { Entry, findCredentials } = await import("@napi-rs/keyring");
      const a = new Entry("svc", "acct");
      console.log(JSON.stringify([a.getPassword(), a.deleteCredential()]));
      a.setPassword("pw1");
      console.log(JSON.stringify([a.getPassword(), findCredentials("svc"), findCredentials("other")]));
      console.log(JSON.stringify([a.deleteCredential(), a.getPassword(), a.deletePassword()]));
    `;
    const outcome = runInFreshNode(script, { FAKE_KEYRING_FILE: file });
    expect(outcome.status, outcome.stderr).toBe(0);
    expect(outcome.stdout.trim().split("\n")).toEqual([
      JSON.stringify([null, false]),
      JSON.stringify(["pw1", [{ account: "acct", password: "pw1" }], []]),
      JSON.stringify([true, null, false]),
    ]);
  });

  it("makes the import throw with FAKE_KEYRING_UNAVAILABLE=1, and every call throw without FAKE_KEYRING_FILE", () => {
    const unavailable = runInFreshNode(`await import("@napi-rs/keyring");`, {
      FAKE_KEYRING_FILE: path.join(scratch, "unused.json"),
      FAKE_KEYRING_UNAVAILABLE: "1",
    });
    expect(unavailable.status).not.toBe(0);
    expect(unavailable.stderr).toContain("FAKE_KEYRING_UNAVAILABLE=1");

    const noFile = runInFreshNode(`const { Entry } = await import("@napi-rs/keyring"); new Entry("s", "a").getPassword();`, {});
    expect(noFile.status).not.toBe(0);
    expect(noFile.stderr).toContain("FAKE_KEYRING_FILE is not set");
  });
});
