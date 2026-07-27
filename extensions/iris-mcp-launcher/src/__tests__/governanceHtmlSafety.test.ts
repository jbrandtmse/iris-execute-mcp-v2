/**
 * Story 32.2 QA — webview HTML SAFETY spot-check on the governance view's
 * HTML generators (`governanceView.ts`), with HOSTILE fixture strings in
 * every user-controllable surface the editor renders:
 *
 *   - a Server Manager server named `<img src=x onerror=alert(1)>` (the
 *     roster flows into profile TABS);
 *   - a profile named by the governance FILE itself (`profile "<img …>"` in
 *     `diff --json` layer labels — a JSON key the file's author controls);
 *   - a hostile governance file PATH (rendered in the header);
 *   - hostile engine text (`validate --json`'s error, `universe`'s note —
 *     third-party text the view quotes inline);
 *   - a hostile key in a diff entry (file content, rendered in the diff
 *     preview and the pending-changes table);
 *   - a hostile preset name (env-sourced, display-only).
 *
 * Asserts, for BOTH `renderGovernanceHtml` and `renderEmptyStateHtml`:
 *
 *   1. The CSP meta gates scripts behind the supplied nonce
 *      (`script-src 'nonce-<n>'`, `default-src 'none'`).
 *   2. NO inline script lacks the nonce — exactly one `<script>` tag exists
 *      and it carries `nonce="<n>"`.
 *   3. Every hostile string reaches the document HTML-ESCAPED (the raw
 *      `<img src=x onerror=…>` / `<script>alert(1)</script>` byte sequences
 *      NEVER appear, so attribute- and element-injection both fail).
 *
 * The dev stage's `governanceView.test.ts` covers rendering correctness with
 * tame fixtures; nothing there drives hostile input through the escape
 * discipline. These fixtures do (Rule #36 note: the hostile strings are
 * attack-shaped fixtures, not engine captures — the surfaces they target ARE
 * fed by engine/file/Server-Manager data at runtime).
 */
import { describe, expect, it } from "vitest";
import {
  GLOBAL_TAB,
  computeProfileTabs,
  renderEmptyStateHtml,
  renderGovernanceHtml,
  stageToggle,
  type DiffJson,
  type GovernanceViewState,
  type UniverseJson,
} from "../governanceView.js";

const NONCE = "qa32fixednonce0001";
const IMG = "<img src=x onerror=alert(1)>";
const SCRIPT = "<script>alert(1)</script>";

/** Build a view state saturated with hostile strings in every user-controllable field. */
function hostileState(): GovernanceViewState {
  const file = `C:\\gov\\${SCRIPT}.json`;
  const hostileDiff: DiffJson = {
    file,
    entries: [
      {
        layer: `profile "${IMG}"`,
        key: `iris_doc_put">${SCRIPT}`,
        file: false,
        default: true,
        differs: true,
      },
    ],
    note: "diff note",
  };
  const universe: UniverseJson = {
    profile: "default",
    file,
    preset: null,
    universeSource: "qa",
    packages: [
      {
        pkg: "iris-dev-mcp",
        tools: [{ name: "iris_doc_put", keys: ["iris_doc_put"] }],
      },
    ],
    frameworkTool: { name: "iris_server_profiles", keys: ["iris_server_profiles"] },
    keys: ["iris_doc_put", "iris_server_profiles"],
    postFoundation: [],
    mutates: { iris_doc_put: "write", iris_server_profiles: "read" },
    defaultEnabledWrites: [],
    policy: { iris_doc_put: false, iris_server_profiles: true },
    configSource: { iris_doc_put: "file", iris_server_profiles: "default" },
    note: `engine note ${IMG}`,
  };
  const tabs = computeProfileTabs([IMG], hostileDiff);
  const state: GovernanceViewState = {
    file,
    fileExists: true,
    engineMode: "local",
    validation: { ok: false, error: `engine says ${IMG}` },
    diff: hostileDiff,
    universeByTab: { [GLOBAL_TAB]: universe },
    profileTabs: tabs,
    activeTab: GLOBAL_TAB,
    staged: [],
    preset: `preset-${IMG}`,
    loadError: `resolution failed ${SCRIPT}`,
  };
  // Stage an edit against the hostile diff key so the PENDING-CHANGES table
  // (tab label + key + values) renders it too.
  return stageToggle(state, GLOBAL_TAB, `iris_doc_put">${SCRIPT}`, "enabled");
}

function expectCspAndSingleNoncedScript(html: string): void {
  expect(html).toContain(`script-src 'nonce-${NONCE}'`);
  expect(html).toContain("default-src 'none'");
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  expect(scriptTags).toHaveLength(1);
  expect(scriptTags[0]).toBe(`<script nonce="${NONCE}">`);
}

function expectFullyEscaped(html: string, hostile: string): void {
  expect(html, `raw hostile bytes must never reach the document: ${hostile}`).not.toContain(
    hostile,
  );
  // …but the content DID render — escaped — so the test is not vacuous.
  expect(html).toContain("&lt;");
}

describe("Story 32.2 QA — webview HTML safety (hostile fixtures through the escape discipline)", () => {
  it("renderGovernanceHtml: CSP nonce on the only script tag, and every user-controllable surface HTML-escaped", () => {
    const html = renderGovernanceHtml(hostileState(), NONCE);

    expectCspAndSingleNoncedScript(html);

    // The hostile element/attribute payloads appear NOWHERE raw — not in the
    // header (file path), tabs (Server Manager + file-derived profile names),
    // banners (validation error, load error), diff preview, pending-changes
    // table, preset label, or the engine note.
    expectFullyEscaped(html, IMG);
    expectFullyEscaped(html, SCRIPT);
    // The escaped forms prove the surfaces genuinely rendered the hostile
    // data (an absent surface would also produce zero raw hits).
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renderGovernanceHtml: a hostile key in a data-msg attribute cannot break out of the attribute (quote-escaping proof)", () => {
    const html = renderGovernanceHtml(hostileState(), NONCE);
    // Every data-msg attribute is JSON stringified THEN HTML-escaped, so a
    // `"` inside a profile name becomes &quot; and the attribute boundary
    // holds. No raw `"` immediately followed by `>` inside any attribute:
    // the tab buttons render the hostile tab name only in escaped form.
    expect(html).not.toContain(`"${IMG}"`);
    expect(html).toContain("&quot;");
  });

  it("renderEmptyStateHtml: CSP nonce on the only script tag, and a hostile engine resolution error is escaped", () => {
    const html = renderEmptyStateHtml(NONCE, `engine exploded ${IMG} ${SCRIPT}`);

    expectCspAndSingleNoncedScript(html);
    expectFullyEscaped(html, IMG);
    expectFullyEscaped(html, SCRIPT);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
