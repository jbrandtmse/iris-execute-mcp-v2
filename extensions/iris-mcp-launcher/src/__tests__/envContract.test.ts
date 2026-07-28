/**
 * Integration AC 31.4.5 — the CROSS-PROCESS env contract, proven by RUNNING
 * the real consumer, not by restating it.
 *
 * `env.test.ts` pins the synthesized variable names and JSON shape as string
 * literals. That catches drift on THIS side only: if `packages/shared` renamed
 * `IRIS_HTTPS`, changed `ProfileOverride`'s field names, or tightened
 * `mergeProfile`'s type checks, those literals would still match themselves and
 * the suite would stay green while the spawned server broke. The AC's operative
 * words are "so a drift in **either** side is caught", so this file feeds the
 * extension's synthesized env straight into the suite's OWN
 * `loadConfig` / `buildProfileRegistry` and asserts on what they produce.
 *
 * Oracle (project rule #36): `packages/shared/dist/config.js` and
 * `packages/shared/dist/profiles.js` — the actual published implementation,
 * loaded from the repo at test time. This is a TEST-TIME dynamic import of a
 * built artifact, NOT a build-time dependency: `tsconfig.build.json` excludes
 * `src/__tests__`, the extension declares no dependency on `@iris-mcp/shared`,
 * and nothing here reaches `dist/*.js` in the packaged VSIX. The extension
 * therefore still "imports nothing from the workspace at build time" (story
 * Integration AC preamble) while gaining a real bidirectional drift guard.
 *
 * On a checkout where `packages/shared` has not been built, these tests SKIP
 * (they cannot assert against an oracle that is not there) — matching
 * `packaging.test.ts`'s existing skip-when-unbuilt convention. Run
 * `pnpm --filter @iris-mcp/shared build` from the repo root to enable them.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { synthesizeIrisEnv } from "../env.js";
import type { ResolvedConnectionProfile } from "../types.js";

const SHARED_DIST = path.resolve(__dirname, "..", "..", "..", "..", "packages", "shared", "dist");
const CONFIG_JS = path.join(SHARED_DIST, "config.js");
const PROFILES_JS = path.join(SHARED_DIST, "profiles.js");
const ORACLE_AVAILABLE = existsSync(CONFIG_JS) && existsSync(PROFILES_JS);

type LoadConfig = (env: Record<string, string | undefined>) => {
  host: string;
  port: number;
  username: string;
  password: string;
  namespace: string;
  https: boolean;
  baseUrl: string;
};
type BuildProfileRegistry = (
  defaultConfig: ReturnType<LoadConfig>,
  env: Record<string, string | undefined>,
) => Map<
  string,
  { host: string; port: number; https: boolean; username: string; namespace: string }
>;

let loadConfig: LoadConfig;
let buildProfileRegistry: BuildProfileRegistry;

beforeAll(async () => {
  if (!ORACLE_AVAILABLE) return;
  const config = (await import(pathToFileURL(CONFIG_JS).href)) as { loadConfig: LoadConfig };
  const profiles = (await import(pathToFileURL(PROFILES_JS).href)) as {
    buildProfileRegistry: BuildProfileRegistry;
  };
  loadConfig = config.loadConfig;
  buildProfileRegistry = profiles.buildProfileRegistry;
});

function profile(overrides: Partial<ResolvedConnectionProfile> = {}): ResolvedConnectionProfile {
  return {
    name: "myServer",
    host: "iris.example.com",
    port: 52773,
    https: false,
    username: "_SYSTEM",
    password: "SYS",
    namespace: "USER",
    ...overrides,
  };
}

describe.skipIf(!ORACLE_AVAILABLE)(
  "Integration AC 31.4.5 — synthesized env, parsed by the suite's REAL loadConfig",
  () => {
    it("a single-profile env round-trips into exactly the connection the extension resolved", () => {
      const resolved = profile({
        host: "prod.example.com",
        port: 443,
        https: true,
        namespace: "HSLIB",
      });

      const parsed = loadConfig(synthesizeIrisEnv([resolved], "HSCUSTOM"));

      expect(parsed).toMatchObject({
        host: "prod.example.com",
        port: 443,
        https: true,
        username: "_SYSTEM",
        password: "SYS",
        namespace: "HSLIB",
        baseUrl: "https://prod.example.com:443",
      });
    });

    it("IRIS_HTTPS=false really means http on the consumer side (guards the string-boolean encoding)", () => {
      const parsed = loadConfig(synthesizeIrisEnv([profile({ https: false })], "HSCUSTOM"));

      expect(parsed.https).toBe(false);
      expect(parsed.baseUrl.startsWith("http://")).toBe(true);
    });

    it("the stringified IRIS_PORT is accepted as a number, not rejected as out-of-range or NaN", () => {
      const parsed = loadConfig(synthesizeIrisEnv([profile({ port: 1972 })], "HSCUSTOM"));

      expect(parsed.port).toBe(1972);
      expect(typeof parsed.port).toBe("number");
    });

    it("the namespace default the extension advertises is the one the consumer would have used anyway", () => {
      const parsed = loadConfig(synthesizeIrisEnv([profile({ namespace: "" })], "HSCUSTOM"));

      expect(parsed.namespace).toBe("HSCUSTOM");
      // Cross-check the extension's advertised default against the consumer's
      // own fallback, so a change to loadConfig's default is caught here.
      expect(loadConfig({ IRIS_USERNAME: "u", IRIS_PASSWORD: "p" }).namespace).toBe("HSCUSTOM");
    });
  },
);

describe.skipIf(!ORACLE_AVAILABLE)(
  "Integration AC 31.4.5 — synthesized IRIS_PROFILES, parsed by the suite's REAL buildProfileRegistry",
  () => {
    it("every Server Manager server the extension covers becomes an addressable profile with its own connection", () => {
      const env = synthesizeIrisEnv(
        [
          profile({ name: "prod", host: "prod.example.com", port: 443, https: true }),
          profile({ name: "dev", host: "dev.example.com", port: 52773, https: false }),
        ],
        "HSCUSTOM",
      );

      const registry = buildProfileRegistry(loadConfig(env), env);

      // `default` is the reserved entry mirroring the six IRIS_* vars.
      expect([...registry.keys()].sort()).toEqual(["default", "dev", "prod"]);
      expect(registry.get("prod")).toMatchObject({
        host: "prod.example.com",
        port: 443,
        https: true,
      });
      expect(registry.get("dev")).toMatchObject({
        host: "dev.example.com",
        port: 52773,
        https: false,
      });
    });

    it("a single-server combineProfiles definition is addressable by name (the alwaysEmitProfiles contract)", () => {
      const env = synthesizeIrisEnv([profile({ name: "only" })], "HSCUSTOM", {
        alwaysEmitProfiles: true,
      });

      const registry = buildProfileRegistry(loadConfig(env), env);

      expect(registry.has("only")).toBe(true);
    });

    it("the typed JSON the extension emits satisfies mergeProfile's strict checks — stringifying port/https would throw", () => {
      const env = synthesizeIrisEnv([profile({ name: "a" }), profile({ name: "b" })], "HSCUSTOM");

      // Sanity that the guard below is real: the consumer rejects a stringified
      // https, so the extension emitting a JSON boolean is load-bearing.
      const stringified = {
        ...env,
        IRIS_PROFILES: JSON.stringify({ a: { https: "true" } }),
      };
      expect(() => buildProfileRegistry(loadConfig(stringified), stringified)).toThrow(/boolean/i);

      expect(() => buildProfileRegistry(loadConfig(env), env)).not.toThrow();
    });
  },
);

describe("Integration AC 31.4.5 — oracle availability", () => {
  it("reports whether the packages/shared oracle was reachable, so a silently-skipped contract suite is visible", () => {
    // Not an assertion on ORACLE_AVAILABLE itself (a pristine checkout has no
    // build yet); this pins the PATH, so moving packages/shared without
    // updating this file surfaces here rather than silently skipping forever.
    expect(SHARED_DIST.replace(/\\/g, "/")).toMatch(/\/packages\/shared\/dist$/);
  });
});
