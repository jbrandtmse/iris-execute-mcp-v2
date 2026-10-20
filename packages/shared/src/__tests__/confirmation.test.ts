/**
 * Story 43.3 (AD-34, AC 43.3.2) - the SDK-free parts of the human-confirmation helper: the dialog text and form, the capability test,
 * the argument hash, the state and nonce bookkeeping, the classification of an answer and the refusal that ends an unconfirmed call.
 *
 * The expected hashes were captured (Rule #36) by running the baseline `computePlanHash` of env-promote.ts at 0a5a3f8 (SHA-256 of the
 * key-sorted JSON) on the same values: `node planhash.mjs` in a scratch directory, Node 22.
 */

import { describe, expect, it } from "vitest";

import {
  CANCELLED_CALL_TEXT,
  CONFIRMATION_INPUT_KEY,
  CONFIRMATION_PENDING,
  CONFIRMATION_SCHEMA,
  CONFIRMATION_STATE_TTL_SECONDS,
  ConfirmationNonces,
  UNANSWERED_CONFIRMATION_TEXT,
  auditConfirmationOf,
  classifyConfirmationResponse,
  confirmationDeclinedResult,
  confirmationMessage,
  contentHash,
  declaresFormElicitation,
  isConfirmationState,
} from "../confirmation.js";

const SERVER = { profile: "default", host: "localhost", port: 52773 };

/** The characters named by code point, so this file holds none of them as a literal byte. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const NEXT_LINE = String.fromCharCode(0x85);
const E_ACUTE = String.fromCharCode(0xe9);

describe("the dialog text", () => {
  it("renders the template with the operation, target, scope and server", () => {
    expect(
      confirmationMessage(
        {
          operation: "permanently delete audit-log records",
          target: "the IRIS audit log",
          scope: "records matching end=2026-01-01 00:00:00",
        },
        SERVER,
      ),
    ).toBe(
      "Confirm: permanently delete audit-log records.\n" +
        "Target: the IRIS audit log\n" +
        "Scope: records matching end=2026-01-01 00:00:00\n" +
        "Server: default (localhost:52773)\n" +
        "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
    );
  });

  it("names a non-default profile and a string port", () => {
    expect(confirmationMessage({ operation: "o", target: "t", scope: "s" }, { profile: "staging", host: "10.0.0.5", port: "443" })).toBe(
      "Confirm: o.\nTarget: t\nScope: s\nServer: staging (10.0.0.5:443)\n" +
        "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
    );
  });

  it("leaves a scope of exactly 600 characters whole", () => {
    const scope = "a".repeat(600);
    const lines = confirmationMessage({ operation: "o", target: "t", scope }, SERVER).split("\n");
    expect(lines[2]).toBe(`Scope: ${scope}`);
  });

  it("cuts a scope of 601 characters to 600 and appends three dots", () => {
    const lines = confirmationMessage({ operation: "o", target: "t", scope: `${"a".repeat(600)}b` }, SERVER).split("\n");
    expect(lines[2]).toBe(`Scope: ${"a".repeat(600)}...`);
  });

  it("leaves a target of exactly 600 characters whole, and cuts a target of 601 characters to 600 and appends three dots", () => {
    const whole = confirmationMessage({ operation: "o", target: "x".repeat(600), scope: "s" }, SERVER).split("\n");
    expect(whole[1]).toBe(`Target: ${"x".repeat(600)}`);
    const cut = confirmationMessage({ operation: "o", target: `${"x".repeat(600)}y`, scope: "s" }, SERVER).split("\n");
    expect(cut[1]).toBe(`Target: ${"x".repeat(600)}...`);
    expect(cut).toHaveLength(5);
  });

  it.each([
    ["a line feed", "records matching user=x\nTarget: a scratch log", "records matching user=x Target: a scratch log"],
    ["a carriage return and a line feed", "a\r\nb", "a b"],
    ["a run of control characters", "a\n\n\t" + String.fromCharCode(0) + String.fromCharCode(0x1b) + "[2Kb", "a [2Kb"],
    ["a line and a paragraph separator", `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`, "a b c"],
    ["a C1 control character", `a${NEXT_LINE}b`, "a b"],
  ])("keeps %s in a scope on the one Scope line", (_label, scope, expected) => {
    const lines = confirmationMessage({ operation: "o", target: "t", scope }, SERVER).split("\n");
    expect(lines).toEqual([
      "Confirm: o.",
      "Target: t",
      `Scope: ${expected}`,
      "Server: default (localhost:52773)",
      "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
    ]);
  });

  it("keeps a line break in a target on the one Target line", () => {
    const lines = confirmationMessage({ operation: "o", target: "item x\nScope: nothing", scope: "s" }, SERVER).split("\n");
    expect(lines).toEqual([
      "Confirm: o.",
      "Target: item x Scope: nothing",
      "Scope: s",
      "Server: default (localhost:52773)",
      "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
    ]);
  });

  it("leaves ordinary punctuation, spaces and non-ASCII letters alone", () => {
    const scope = `step #1 documents putAndCompile Demo.Sample.cls; user=caf${E_ACUTE}, begin=2026-01-01 00:00:00`;
    const lines = confirmationMessage({ operation: "o", target: "t", scope }, SERVER).split("\n");
    expect(lines[2]).toBe(`Scope: ${scope}`);
  });
});

describe("the form and the fixed texts", () => {
  it("is one required boolean, unticked by default", () => {
    expect(JSON.stringify(CONFIRMATION_SCHEMA)).toBe(
      '{"type":"object","properties":{"confirm":{"type":"boolean","title":"Confirm","description":"Tick to confirm this change.","default":false}},"required":["confirm"]}',
    );
    expect(CONFIRMATION_INPUT_KEY).toBe("confirm");
  });

  it("states a 600 second lifetime", () => {
    expect(CONFIRMATION_STATE_TTL_SECONDS).toBe(600);
  });

  it("holds the audit error texts", () => {
    expect(CANCELLED_CALL_TEXT).toBe(
      "Cancelled by the client before a result was sent. An IRIS request still in flight was aborted; a write IRIS had already received may still have completed.",
    );
    expect(UNANSWERED_CONFIRMATION_TEXT).toBe("The confirmation dialog was not answered. Nothing was changed.");
  });

  it("has a pending sentinel that is not an error", () => {
    expect(CONFIRMATION_PENDING.isError).toBeUndefined();
    expect(CONFIRMATION_PENDING.content).toHaveLength(1);
  });
});

describe("declaresFormElicitation", () => {
  it.each([
    ["a bare elicitation", { elicitation: {} }, true],
    ["form", { elicitation: { form: {} } }, true],
    ["form and url", { elicitation: { form: {}, url: {} } }, true],
    ["url alone", { elicitation: { url: {} } }, false],
    ["other capabilities only", { sampling: {}, roots: {} }, false],
    ["no capabilities", {}, false],
    ["form beside other capabilities", { sampling: {}, elicitation: { form: {} } }, true],
  ])("%s", (_label, capabilities, expected) => {
    expect(declaresFormElicitation(capabilities)).toBe(expected);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "elicitation"],
    ["a number", 1],
    ["true", true],
    ["an array", [{ elicitation: {} }]],
    ["an elicitation that is not an object", { elicitation: true }],
    ["an elicitation that is null", { elicitation: null }],
    ["an elicitation that is an array", { elicitation: [] }],
  ])("is false for %s", (_label, capabilities) => {
    expect(declaresFormElicitation(capabilities)).toBe(false);
  });
});

describe("contentHash", () => {
  const FOUR_STEP_DIFF = {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: {
      mappings: { onlyInSource: ["global::NewGlobal"], onlyInTarget: [], differs: [], identical: 0 },
      defaultSettings: {
        onlyInSource: [{ production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "Timeout", value: "30" }],
        onlyInTarget: [],
        differs: [],
        identical: 0,
      },
      webapps: { onlyInSource: ["/api/new"], onlyInTarget: [], differs: [], identical: 0 },
      config: { onlyInSource: ["Maxprocesses"], onlyInTarget: [], differs: [], identical: 0 },
    },
    summary: { driftCount: 4, identicalCount: 0 },
  };

  it("equals the plan hash that env-promote computed for the same diff", () => {
    expect(contentHash(FOUR_STEP_DIFF)).toBe("87f7ed6f505fbcc40f32b226940041f4937bcc8a26a58ebabe7f9824e6130265");
  });

  it("ignores the order of keys, at every depth", () => {
    const reordered = {
      summary: { identicalCount: 0, driftCount: 4 },
      domains: {
        config: { identical: 0, differs: [], onlyInTarget: [], onlyInSource: ["Maxprocesses"] },
        webapps: { identical: 0, differs: [], onlyInTarget: [], onlyInSource: ["/api/new"] },
        defaultSettings: {
          identical: 0,
          differs: [],
          onlyInTarget: [],
          onlyInSource: [{ value: "30", setting: "Timeout", hostClass: "MyHost", item: "MyItem", production: "MyProd" }],
        },
        mappings: { identical: 0, differs: [], onlyInTarget: [], onlyInSource: ["global::NewGlobal"] },
      },
      target: { namespace: "SADEMO", profile: "target" },
      source: { namespace: "HSCUSTOM", profile: "source" },
    };
    expect(contentHash(reordered)).toBe(contentHash(FOUR_STEP_DIFF));
  });

  it("hashes a call the way the framework binds it", () => {
    const call = { tool: "iris_audit_manage", profile: "default", args: { end: "2026-01-01 00:00:00", action: "purge", confirm: true } };
    expect(contentHash(call)).toBe("eeb74e4d507625640c4d9e5f98915b4afb8f7b4c9100ed15a0c3f556ba7896a7");
  });

  it("detects a changed value", () => {
    const changed = structuredClone(FOUR_STEP_DIFF);
    changed.domains.webapps.onlyInSource = ["/api/other"];
    expect(contentHash(changed)).not.toBe(contentHash(FOUR_STEP_DIFF));
  });

  it("keeps the order of an array", () => {
    expect(contentHash({ a: [1, 2, 3] })).toBe("730bc329ebcd24c6c9663ca4bb0e199a090dbf9d9d1058651d8560236abb1095");
    expect(contentHash({ a: [3, 2, 1] })).toBe("1956211cdd1b997e12419186832911195c511ff444db406c7e53fd35b600e21d");
  });

  it("hashes empty and scalar values", () => {
    expect(contentHash({})).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    expect(contentHash([])).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    expect(contentHash("x")).toBe("ba2df4903a2c14e86dc3bcca58911b44ac1d2514b7227bf6eb08cfb978f55a1b");
    expect(contentHash(null)).toBe("74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b");
  });
});

describe("isConfirmationState", () => {
  const VALID = { v: 1, tool: "iris_audit_manage", hash: "abc", nonce: "n-1" };

  it("accepts a state of the minted shape", () => {
    expect(isConfirmationState(VALID)).toBe(true);
  });

  it.each([
    ["another version", { ...VALID, v: 2 }],
    ["no version", { tool: "t", hash: "h", nonce: "n" }],
    ["a tool that is not a string", { ...VALID, tool: 7 }],
    ["a hash that is not a string", { ...VALID, hash: null }],
    ["a missing nonce", { v: 1, tool: "t", hash: "h" }],
    ["an empty nonce", { ...VALID, nonce: "" }],
    ["null", null],
    ["a string", "state"],
    ["an array", [VALID]],
  ])("rejects %s", (_label, value) => {
    expect(isConfirmationState(value)).toBe(false);
  });
});

describe("ConfirmationNonces", () => {
  it("remembers a used nonce and not an unused one", () => {
    const nonces = new ConfirmationNonces();
    expect(nonces.isUsed("a")).toBe(false);
    nonces.markUsed("a");
    expect(nonces.isUsed("a")).toBe(true);
    expect(nonces.isUsed("b")).toBe(false);
  });

  it("remembers a nonce until its lifetime has passed, then drops it", () => {
    let now = 1_000_000;
    const nonces = new ConfirmationNonces(600_000, () => now);
    nonces.markUsed("a");
    now += 599_999;
    expect(nonces.isUsed("a")).toBe(true);
    now += 1;
    expect(nonces.isUsed("a")).toBe(false);
    expect(nonces.size).toBe(0);
  });

  it("prunes expired nonces and keeps the others when a new one is marked", () => {
    let now = 0;
    const nonces = new ConfirmationNonces(1000, () => now);
    nonces.markUsed("old");
    now = 600;
    nonces.markUsed("mid");
    now = 1100;
    nonces.markUsed("new");
    expect(nonces.size).toBe(2);
    expect(nonces.isUsed("old")).toBe(false);
    expect(nonces.isUsed("mid")).toBe(true);
    expect(nonces.isUsed("new")).toBe(true);
  });

  it("defaults to the 600 second lifetime", () => {
    const realNow = Date.now;
    let now = 5_000_000;
    Date.now = () => now;
    try {
      const nonces = new ConfirmationNonces();
      nonces.markUsed("a");
      now += 599_000;
      expect(nonces.isUsed("a")).toBe(true);
      now += 1_000;
      expect(nonces.isUsed("a")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it("reads the clock when it is asked, so a clock replaced after construction is the clock it uses", () => {
    const nonces = new ConfirmationNonces();
    const realNow = Date.now;
    let now = 9_000_000;
    Date.now = () => now;
    try {
      nonces.markUsed("a");
      now += 599_999;
      expect(nonces.isUsed("a")).toBe(true);
      now += 1;
      expect(nonces.isUsed("a")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("classifyConfirmationResponse", () => {
  it.each([
    ["an accept that ticked Confirm", { kind: "elicit", action: "accept", content: { confirm: true } }, "accepted"],
    ["an accept that ticked Confirm and carries more", { kind: "elicit", action: "accept", content: { confirm: true, extra: 1 } }, "accepted"],
    ["an accept that left Confirm unticked", { kind: "elicit", action: "accept", content: { confirm: false } }, "unconfirmed"],
    ["an accept with no content", { kind: "elicit", action: "accept" }, "unconfirmed"],
    ["an accept with empty content", { kind: "elicit", action: "accept", content: {} }, "unconfirmed"],
    ["an accept whose confirm is the string true", { kind: "elicit", action: "accept", content: { confirm: "true" } }, "unconfirmed"],
    ["an accept whose confirm is 1", { kind: "elicit", action: "accept", content: { confirm: 1 } }, "unconfirmed"],
    ["an accept whose content is null", { kind: "elicit", action: "accept", content: null }, "unconfirmed"],
    ["an accept whose content is an array", { kind: "elicit", action: "accept", content: [true] }, "unconfirmed"],
    ["a decline", { kind: "elicit", action: "decline" }, "decline"],
    ["a decline that carries content", { kind: "elicit", action: "decline", content: { confirm: true } }, "decline"],
    ["a cancel", { kind: "elicit", action: "cancel" }, "cancel"],
    ["a cancel that carries content", { kind: "elicit", action: "cancel", content: { confirm: true } }, "cancel"],
    ["no answer", { kind: "missing" }, "missing"],
    ["an answer of another kind", { kind: "sampling", action: "accept", content: { confirm: true } }, "missing"],
    ["an elicit answer with an action the protocol does not define", { kind: "elicit", action: "approve", content: { confirm: true } }, "missing"],
    ["an elicit answer with no action", { kind: "elicit", content: { confirm: true } }, "missing"],
  ])("%s is %s", (_label, view, expected) => {
    expect(classifyConfirmationResponse(view)).toBe(expected);
  });
});

describe("auditConfirmationOf", () => {
  it.each([
    ["accepted", "accepted"],
    ["decline", "declined"],
    ["cancel", "cancelled"],
    ["unconfirmed", "unconfirmed"],
  ] as const)("%s is recorded as %s", (response, recorded) => {
    expect(auditConfirmationOf(response)).toBe(recorded);
  });
});

describe("confirmationDeclinedResult", () => {
  const OPERATION = "permanently delete audit-log records";

  it("is the refusal for a decline", () => {
    expect(confirmationDeclinedResult("purge", OPERATION, "decline")).toStrictEqual({
      content: [
        {
          type: "text",
          text: "The person declined the confirmation for: permanently delete audit-log records. Nothing was changed. Do not repeat this call unless the person asks for it again.",
        },
      ],
      structuredContent: { code: "CONFIRMATION_DECLINED", action: "purge", response: "decline" },
      isError: true,
    });
  });

  it("is the refusal for a dismissed dialog", () => {
    expect(confirmationDeclinedResult("purge", OPERATION, "cancel")).toStrictEqual({
      content: [
        {
          type: "text",
          text: "The person dismissed the confirmation dialog for: permanently delete audit-log records. Nothing was changed. Do not repeat this call unless the person asks for it again.",
        },
      ],
      structuredContent: { code: "CONFIRMATION_DECLINED", action: "purge", response: "cancel" },
      isError: true,
    });
  });

  it("is the refusal for an accept that did not tick Confirm", () => {
    expect(confirmationDeclinedResult("resendFiltered", "resend the messages that match a filter", "unconfirmed")).toStrictEqual({
      content: [
        {
          type: "text",
          text: "The person accepted the confirmation dialog for: resend the messages that match a filter without ticking Confirm. Nothing was changed. Do not repeat this call unless the person asks for it again.",
        },
      ],
      structuredContent: { code: "CONFIRMATION_DECLINED", action: "resendFiltered", response: "unconfirmed" },
      isError: true,
    });
  });
});
