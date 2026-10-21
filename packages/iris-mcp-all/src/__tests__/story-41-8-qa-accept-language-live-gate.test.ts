/**
 * Story 41.8, DW-635: the production path of the ONE-argument `ExecuteMCPv2.Utils:SanitizeError` and
 * `ExecuteMCPv2.Coverage.Job:SafeText` under a non-English request language, driven on the real wire (rule #59: each
 * block names the path it guards).
 *
 * Opt-in only. The gate touches an instance only when `IRIS_REQUIRE_LIVE` is `1` (or `true`) AND `IRIS_HOST`,
 * `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE` are all set; it never falls back to a default
 * instance. Without the arming variable every live row is skipped with the reason and no request is made, so a plain
 * `pnpm test` reaches no IRIS. Armed, every prerequisite fails closed with "may not be skipped": a target variable
 * that is not set, an unreachable host, refused credentials (HTTP 401 or 403), an absent route (HTTP 404), a body
 * that is not the envelope, or deployed classes whose `BOOTSTRAP_VERSION` is not this tree's embed
 * (`packages/shared/src/bootstrap-classes.ts`). The gate drives no built code, so it compares the deployment with the
 * checked-in embed, not with a dist. `scripts/prepublish-gate.mjs` arms it (`gateTestFiles`).
 *
 * The request language. A `%CSP.REST` worker matches its message language from the request's `Accept-Language` on
 * every request, with no session, so the one-argument `GetErrorText(status)` in that worker reads the status in the
 * request's language. The OS class `SanitizeErrorLocaleTest` runs in a job whose session language is `en-us` and
 * reaches other languages only through the explicit argument, so a one-argument call that reads in a FIXED language
 * (for example `GetErrorText(pStatus, "en-us")`) keeps every OS row green; only a request in another language tells
 * them apart. Sending the empty branch through `GetErrorText(pStatus, pLanguage)` with `pLanguage` empty is an
 * equivalent change, not a defect: it reads the same table as the one-argument call in every request language.
 *
 * Block 1, `GET /api/executemcp/v2/global` with NO `global` parameter: `Global:GetGlobal`, `Utils.ValidateRequired`,
 * the one-argument `Utils.SanitizeError(tSC)`, `RenderResponseBody`; a read-only validation refusal. Per
 * `Accept-Language`, `errors[0].error` is exactly `<word> #5001: Required parameter 'global' is missing or empty`:
 * one prefix, in that language (the pre-41.8 code doubled it for fr, de and ja). The summary begins with the same
 * prefix and holds it once.
 *
 * Block 2, `POST /api/executemcp/v2/classmethod` of `%SYSTEM.Status:GetErrorText` with no argument: a real
 * `<UNDEFINED>` `%Exception.SystemException` (code 5002) that the route's `Catch` renders through the one-argument
 * `SanitizeError(ex.AsStatus())`. The text starts with the language's own `#5001: ` prefix, then the language's own
 * ObjectScript-error phrase, then `<UNDEFINED>`, and holds no second prefix. The refusal of block 1 is a code-5001
 * status whose message is English application text, so a status read in the wrong language still renders the right
 * final text there; only a status whose inner message is localized (code 5002) shows which language it was read in,
 * so the fixed-language read above is red here and green in block 1.
 *
 * Block 3, `POST /api/executemcp/v2/classmethod` of `ExecuteMCPv2.Coverage.Job:SafeText` with ONE argument, the
 * recorded text `<word> #5001: disk full` in the request's language, as the REST coverage routes call it on recorded
 * run errors: the return value is the input unchanged, its code kept and no wrapper prefix added. A `SafeText` that
 * reads the sanitized status with the one-argument `GetErrorText` and strips only an English `ERROR #5001: ` marker
 * (the pre-41.8 tail) returns the fr, de and ja text doubled, while the OS class, in its `en-us` job, stays green.
 *
 * The words are the live pin of the 15 `%ObjectErrors` tables that `SanitizeErrorLocaleTest:PinnedWord` carries; the
 * first test reads them from that source. The English control (`en-US,en;q=0.9`, the header the suite sends on every
 * request) proves the rows can tell languages apart. Every request is a read: a GET per block-1 row, a POST that
 * invokes a system method with a missing argument, a POST of a method that only computes a string, and one Atelier
 * query of the deployed version. The gate writes nothing, creates no fixture and starts no production and no
 * Line-by-Line session. Credentials are never printed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atelierQuery,
  irisTargetFromEnv,
  isIrisReachable,
  rawIrisRequest,
  skipTest,
  type IrisTarget,
  type RawIrisAnswer,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-41-8-qa-accept-language-live-gate";
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
/** The variables an armed run must set: the gate never falls back to a default instance. */
const TARGET_VARIABLES = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE"] as const;
/**
 * The target, assigned by {@link liveSkipReason} once the gate is armed and every target variable is set. A row reaches it
 * only after `liveSkipReason` returned no reason, and an armed run with a variable unset fails in `beforeAll` naming
 * the variables (it never resolves a target).
 */
let TARGET: IrisTarget;

/** A row's own wait: longer than the 60-second abort of its request, so a stalled request reports its own error. */
const ROW_TIMEOUT_MS = 90_000;

/** The route under test and the text `Utils.ValidateRequired` gives a missing `global`. */
const ROUTE = "/api/executemcp/v2/global";
const REFUSAL_TEXT = "Required parameter 'global' is missing or empty";
/** The route of `iris_execute_classmethod`: it runs the method in the REST worker and renders its errors through `SanitizeError(tSC)`. */
const CLASSMETHOD_ROUTE = "/api/executemcp/v2/classmethod";
/** The message of the recorded text block 3 hands to `SafeText`. */
const RECORDED_MESSAGE = "disk full";

/** `GetErrorText($$$ERROR(5001, ...), L)` is `<word> #5001: ...`: the word of each language the rows send. */
interface Row {
  /** The `Accept-Language` header value. */
  header: string;
  /** The message-table language the header matches. */
  language: string;
  /** The word before ` #5001: `, written with escapes for any non-ASCII character. */
  word: string;
  /**
   * The text the 5002 (ObjectScript error) message puts before its `<UNDEFINED>` token in that language. It is read
   * from the status's inner message, so only a status read in the request language carries it. Captured live
   * 2026-10-20 (IRIS 2026.2 Build 221U) with `POST /classmethod` of `%SYSTEM.Status:GetErrorText` and no arguments,
   * one request per `Accept-Language`; the Japanese text has no space before the token.
   */
  innerLead: string;
  /** Marks the English control. */
  control: boolean;
}

/** The katakana word for "error", by code point (12456, 12521, 12540), so the source stays ASCII. */
const KATAKANA_ERROR = String.fromCodePoint(12456, 12521, 12540);

const ROWS: readonly Row[] = [
  { header: "fr", language: "fr", word: "ERREUR", innerLead: "Erreur ObjectScript: ", control: false },
  { header: "de", language: "de", word: "FEHLER", innerLead: "ObjectScript-Fehler: ", control: false },
  { header: "ja", language: "ja", word: KATAKANA_ERROR, innerLead: `ObjectScript ${KATAKANA_ERROR}:`, control: false },
  { header: "en-US,en;q=0.9", language: "en-us", word: "ERROR", innerLead: "ObjectScript error: ", control: true },
];

/** The parts of the ExecuteMCPv2 envelope the rows read. */
interface Envelope {
  status?: { errors?: Array<{ error?: string; code?: number }>; summary?: string };
  result?: { returnValue?: unknown };
}

/** The answer's body as the envelope; `undefined` when it is not a JSON object. */
function envelopeOf(answer: RawIrisAnswer): Envelope | undefined {
  return typeof answer.json === "object" && answer.json !== null ? (answer.json as Envelope) : undefined;
}

/** `GET` the route with no `global` parameter: a read-only validation refusal. */
function requestRefusal(acceptLanguage: string): Promise<RawIrisAnswer> {
  return rawIrisRequest(TARGET, `${ROUTE}?namespace=${encodeURIComponent(TARGET.namespace)}`, {
    method: "GET",
    acceptLanguage,
  });
}

/** `POST /classmethod` of `className:methodName` with `args` (none when omitted), in the request language `acceptLanguage`. */
function requestClassMethod(
  acceptLanguage: string,
  className: string,
  methodName: string,
  args?: readonly string[],
): Promise<RawIrisAnswer> {
  return rawIrisRequest(TARGET, CLASSMETHOD_ROUTE, {
    method: "POST",
    body: { className, methodName, namespace: TARGET.namespace, ...(args !== undefined ? { args } : {}) },
    acceptLanguage,
  });
}

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `PinnedWord` table of `SanitizeErrorLocaleTest`, read from its source: the language -> word map it returns. */
function pinnedWordsFromOsClass(): Map<string, string> {
  const source = readFileSync(
    path.join(REPO_ROOT, "src", "ExecuteMCPv2", "Tests", "SanitizeErrorLocaleTest.cls"),
    "utf8",
  );
  const method = /ClassMethod PinnedWord\(pLang As %String\) As %String\s*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  const words = new Map<string, string>();
  for (const line of method.split("\n")) {
    const literal = /^\s*"([a-z-]+)":\s*"([^"]*)",?\s*$/.exec(line);
    if (literal) {
      words.set(literal[1] as string, literal[2] as string);
      continue;
    }
    const chars = /^\s*"([a-z-]+)":\s*\$Char\(([\d,\s]+)\),?\s*$/.exec(line);
    if (chars) {
      const codes = (chars[2] as string).split(",").map((code) => Number(code.trim()));
      words.set(chars[1] as string, String.fromCodePoint(...codes));
    }
  }
  return words;
}

/** The `BOOTSTRAP_VERSION` of this tree's checked-in embed; `""` when the file holds none. */
function embedBootstrapVersion(): string {
  const source = readFileSync(path.join(REPO_ROOT, "packages", "shared", "src", "bootstrap-classes.ts"), "utf8");
  return /^export const BOOTSTRAP_VERSION = "((?:\d+\.\d+\.\d+\+\d+\.)?[0-9a-f]+)";$/m.exec(source)?.[1] ?? "";
}

/**
 * Why the live rows cannot run, or `undefined` when they can. It makes no request unless the gate is armed and every
 * target variable is set.
 */
async function liveSkipReason(): Promise<string | undefined> {
  if (!REQUIRE_LIVE) {
    return `opt-in live gate: set IRIS_REQUIRE_LIVE=1 and ${TARGET_VARIABLES.join(", ")} to run it; without them it reaches no IRIS.`;
  }
  const missing = TARGET_VARIABLES.filter((name) => (process.env[name] ?? "") === "");
  if (missing.length > 0) {
    return `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set, and this gate never falls back to a default instance.`;
  }
  TARGET = irisTargetFromEnv();
  if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
    return `IRIS is not reachable at http://${TARGET.host}:${TARGET.port} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
  }
  // One English request proves the credentials are accepted and the route is deployed: a 401, a 404 or a body that
  // is not the envelope would otherwise read as a failure of the language rows.
  const control = await requestRefusal("en-US,en;q=0.9");
  if (control.status === 401 || control.status === 403) {
    return `IRIS at http://${TARGET.host}:${TARGET.port} answered HTTP ${control.status}: the IRIS_USERNAME/IRIS_PASSWORD given are not accepted.`;
  }
  if (control.status === 404) {
    return `ExecuteMCPv2's REST service is not deployed at http://${TARGET.host}:${TARGET.port} (HTTP 404 from ${ROUTE}). Load src/ExecuteMCPv2/ to run this gate.`;
  }
  if (envelopeOf(control)?.status === undefined) {
    return `${ROUTE} answered HTTP ${control.status} with a body that is not the ExecuteMCPv2 envelope.`;
  }
  const embed = embedBootstrapVersion();
  const rows = await atelierQuery(TARGET, "SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version");
  const deployed = String(rows[0]?.["Version"] ?? "");
  if (embed === "" || deployed !== embed) {
    return (
      `the deployed ExecuteMCPv2 classes report BOOTSTRAP_VERSION "${deployed}" but this tree's embed ` +
      `(packages/shared/src/bootstrap-classes.ts) is "${embed}", so the rows would test other classes. Deploy this ` +
      "tree's classes (start a server built from it against the instance), then rerun."
    );
  }
  return undefined;
}

let skipReason: string | undefined;

beforeAll(async () => {
  try {
    skipReason = await liveSkipReason();
  } catch (error) {
    skipReason = `Story 41.8 Accept-Language gate availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 41.8 Accept-Language gate may not be skipped: ${skipReason}`);
  }
}, 120_000);

describe("Story 41.8 QA (DW-635): the words the rows expect are the live pin", () => {
  it("each expected word equals SanitizeErrorLocaleTest:PinnedWord for its language, and the four words differ", () => {
    const pinned = pinnedWordsFromOsClass();
    expect(pinned.size, "the PinnedWord table was parsed from the OS class source").toBe(15);
    for (const row of ROWS) {
      expect(row.word, `the word for ${row.language}`).toBe(pinned.get(row.language));
    }
    expect(new Set(ROWS.map((row) => row.word)).size, "fr, de, ja and the control render four different words").toBe(4);
  });
});

describe("Story 41.8 QA (DW-635): GET /global refusal, one-argument SanitizeError, per request language", () => {
  for (const row of ROWS) {
    const label = row.control ? `Accept-Language ${row.header} (the English control)` : `Accept-Language ${row.header}`;
    it(
      `${label}: errors[0].error is exactly one \`${row.language}\` prefix, then the message`,
      async (ctx) => {
        if (skipReason) {
          skipTest(GATE_TAG, skipReason, ctx);
          return;
        }
        const answer = await requestRefusal(row.header);
        expect(answer.status, answer.text).toBe(200);
        const envelope = envelopeOf(answer);
        const errors = envelope?.status?.errors ?? [];
        expect(errors, answer.text).toHaveLength(1);
        expect(errors[0]?.error, `the error text for ${row.header}`).toBe(`${row.word} #5001: ${REFUSAL_TEXT}`);
        expect(errors[0]?.code).toBe(5001);
        const summary = envelope?.status?.summary ?? "";
        expect(summary.startsWith(`${row.word} #5001: `), `the summary begins with the ${row.language} prefix: ${summary}`).toBe(true);
        expect(occurrences(summary, " #5001: "), "the summary holds one prefix").toBe(1);
      },
      ROW_TIMEOUT_MS,
    );
  }
});

describe("Story 41.8 QA (DW-635): a real <UNDEFINED> exception through POST /classmethod, per request language", () => {
  for (const row of ROWS) {
    it(
      `Accept-Language ${row.header}: one \`${row.language}\` prefix, the <UNDEFINED> token kept, no #5002 prefix left`,
      async (ctx) => {
        if (skipReason) {
          skipTest(GATE_TAG, skipReason, ctx);
          return;
        }
        const answer = await requestClassMethod(row.header, "%SYSTEM.Status", "GetErrorText");
        expect(answer.status, answer.text).toBe(200);
        const errors = envelopeOf(answer)?.status?.errors ?? [];
        expect(errors, answer.text).toHaveLength(1);
        const text = errors[0]?.error ?? "";
        expect(text.startsWith(`${row.word} #5001: `), `the text begins with the ${row.language} prefix: ${text}`).toBe(true);
        // The status was read in the request language: its inner message names the error in that language.
        expect(
          text.startsWith(`${row.word} #5001: ${row.innerLead}<UNDEFINED>`),
          `the inner message is the ${row.language} one, then the <UNDEFINED> token: ${text}`,
        ).toBe(true);
        expect(text, "the status's own #5002 prefix is removed").not.toContain("#5002");
        expect(occurrences(text, " #"), `exactly one prefix: ${text}`).toBe(1);
      },
      ROW_TIMEOUT_MS,
    );
  }
});

describe("Story 41.8 (DW-635): one-argument Coverage.Job:SafeText through POST /classmethod, per request language", () => {
  for (const row of ROWS) {
    it(
      `Accept-Language ${row.header}: SafeText returns the recorded \`${row.language}\` text unchanged, its code kept and no wrapper prefix`,
      async (ctx) => {
        if (skipReason) {
          skipTest(GATE_TAG, skipReason, ctx);
          return;
        }
        const recorded = `${row.word} #5001: ${RECORDED_MESSAGE}`;
        const answer = await requestClassMethod(row.header, "ExecuteMCPv2.Coverage.Job", "SafeText", [recorded]);
        expect(answer.status, answer.text).toBe(200);
        const envelope = envelopeOf(answer);
        expect(envelope?.status?.errors ?? [], answer.text).toEqual([]);
        expect(envelope?.result?.returnValue, `SafeText of the recorded ${row.language} text`).toBe(recorded);
      },
      ROW_TIMEOUT_MS,
    );
  }
});
