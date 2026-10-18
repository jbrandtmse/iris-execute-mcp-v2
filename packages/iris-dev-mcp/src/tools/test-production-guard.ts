/**
 * The TestProduction guard of the test-running tools (Story 40.3).
 *
 * `%UnitTest.TestProduction` stops, and when it will not stop force-stops and cleans, any production in the
 * namespace that is not stopped before it starts its own. So a run that includes a TestProduction test would
 * silently stop another user's production on a shared instance. The decision whether such a run may go ahead
 * is made IRIS-side, under Ens's own production lifecycle lock (AD-27, AD-12): `GET /dev/test/production`
 * answers `proceed` when the namespace's production is stopped or is one the run's TestProduction tests declare
 * as their own, and `busy` otherwise (including when the state cannot be read). This module only asks that
 * route ({@link readProductionGuard}) and turns a `busy` answer into the one `PRODUCTION_BUSY` refusal
 * ({@link productionBusyRefusal}) that `iris_execute_tests` and `iris_test_coverage` share.
 */

import {
  IrisApiError,
  REFUSAL_CODES,
  refusalResult,
  type ToolContext,
  type ToolResult,
} from "@iris-mcp/shared";

/** The custom REST route that makes the decision. */
const PRODUCTION_GUARD_PATH = "/api/executemcp/v2/dev/test/production";

/** The guard sentence both test-running tools carry in their descriptions. */
export const TEST_PRODUCTION_GUARD_SENTENCE =
  "TestProduction guard: a run that includes a %UnitTest.TestProduction test is refused with code " +
  "PRODUCTION_BUSY, and nothing is run, while a production other than those tests' own is running in the " +
  "namespace (or its state cannot be read), because %UnitTest.TestProduction stops any other production " +
  "before it starts its own; that production is left untouched. The guard needs the ExecuteMCPv2 service at " +
  "the version that ships it: on a server without it the run is unguarded.";

/** A TestProduction test of the run and the production it declares. */
export interface ProductionGuardTest {
  /** The test class. */
  class: string;
  /** Its `PRODUCTION` default, `""` when none is set. */
  production: string;
}

/**
 * What the IRIS side decided, as the route and the coverage `Start` outcome return it. `production`, `state`
 * and `stateCode` are present exactly when the production state was read; `error` is the sanitized reason when
 * it could not be.
 */
export interface ProductionGuardResult {
  decision: "proceed" | "busy";
  namespace: string;
  testProductions: ProductionGuardTest[];
  production?: string;
  state?: string;
  stateCode?: number;
  error?: string;
}

/**
 * Ask the IRIS side whether a run of `target` at `level` in `namespace` may go ahead. The values are sent
 * explicitly (Rule #10) and URI-encoded.
 *
 * @param ctx - The tool context; only its HTTP client is used.
 * @param namespace - The resolved target namespace.
 * @param target - The target the run queues: the tool's `target` at package and class level, and at method level
 *   the queued class and, when there is one, the trimmed method name (`Class[:Method]`).
 * @param level - The tool's `level`.
 * @returns The decision, or `undefined` when the route does not exist (HTTP 404: the IRIS-side classes predate
 *   the guard, or the service is not deployed), in which case the run goes ahead unguarded as it did before the
 *   guard. Any other failure is thrown to the caller.
 */
export async function readProductionGuard(
  ctx: Pick<ToolContext, "http">,
  namespace: string,
  target: string,
  level: string,
): Promise<ProductionGuardResult | undefined> {
  const query =
    `target=${encodeURIComponent(target)}&level=${encodeURIComponent(level)}` +
    `&namespace=${encodeURIComponent(namespace)}`;
  try {
    const response = await ctx.http.get<ProductionGuardResult>(`${PRODUCTION_GUARD_PATH}?${query}`);
    const result = (response.result ?? {}) as Partial<ProductionGuardResult>;
    return {
      ...result,
      // Only an explicit proceed lets a run go ahead: an answer that is anything else is not one.
      decision: result.decision === "proceed" ? "proceed" : "busy",
      namespace: result.namespace ?? namespace,
      testProductions: Array.isArray(result.testProductions) ? result.testProductions : [],
    };
  } catch (error: unknown) {
    if (error instanceof IrisApiError && error.statusCode === 404) return undefined;
    throw error;
  }
}

/** `Class (production), Class (production)` for the tests of the run. */
function describeTests(tests: ProductionGuardTest[]): string {
  return tests.map((test) => `${test.class} (${test.production})`).join(", ");
}

/**
 * The `PRODUCTION_BUSY` refusal for a `busy` decision, shared by `iris_execute_tests` and `iris_test_coverage`.
 * Nothing was run and no production was touched.
 *
 * Fields: `namespace`, `state` (`"Unknown"` when the state could not be read), `testProductions`, and when the
 * state was read `production`, or when it could not be `error`.
 *
 * @param guard - The IRIS side's `busy` decision.
 */
export function productionBusyRefusal(guard: ProductionGuardResult): ToolResult {
  const tests = describeTests(guard.testProductions);
  const stateRead = typeof guard.stateCode === "number";
  const fields: Record<string, unknown> = {
    namespace: guard.namespace,
    state: guard.state ?? "Unknown",
    testProductions: guard.testProductions,
  };

  if (!stateRead) {
    const reason = guard.error ?? "no reason was given";
    if (guard.error !== undefined) fields.error = guard.error;
    return refusalResult(
      REFUSAL_CODES.PRODUCTION_BUSY,
      `The production state of namespace ${guard.namespace} could not be read (${reason}), so the TestProduction ` +
        `tests in this run (${tests}) were not run: %UnitTest.TestProduction stops any other production before it ` +
        `starts its own. Try again in a moment.`,
      fields,
    );
  }

  const production = guard.production ?? "";
  const name = production === "" ? "(unnamed)" : production;
  fields.production = production;
  return refusalResult(
    REFUSAL_CODES.PRODUCTION_BUSY,
    `Production '${name}' is ${guard.state ?? "Unknown"} in namespace ${guard.namespace}, and it is not the ` +
      `production of the TestProduction tests in this run (${tests}). %UnitTest.TestProduction stops any other ` +
      `production before it starts its own, so nothing was run and '${name}' was left untouched. Run the tests ` +
      `once it has stopped; if an interrupted test run left it running, stop it with iris_production_control and ` +
      `run the tests again.`,
    fields,
  );
}
