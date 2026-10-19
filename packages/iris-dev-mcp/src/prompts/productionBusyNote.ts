/**
 * The `PRODUCTION_BUSY` note shared by the two prompts that run unit tests
 * (`deploy-and-test-class` step 4 and `edit-and-test-class` step 9).
 *
 * `iris_execute_tests` refuses a run that holds a `%UnitTest.TestProduction`
 * test while a different production runs in the namespace. The refusal either
 * names that production (`production`), or, when the namespace's production
 * state could not be read, carries `state: "Unknown"` and the reason. Both
 * refusals ran nothing. The named-production refusal suggests stopping that
 * production when an interrupted test run left it running; the note asks the
 * model to stop it only once the user confirms it is such a leftover, and to
 * stop no production after an `Unknown` refusal.
 * Server: iris-dev-mcp.
 */

export const PRODUCTION_BUSY_NOTE =
  `If the response is a \`PRODUCTION_BUSY\` refusal, nothing ran. ` +
  `When the refusal has a \`production\` field, that production is running in the namespace and is not the tests' own: ` +
  `tell the user, and do not stop that production unless the user confirms it is a leftover of an interrupted test run. ` +
  `When its \`state\` is \`Unknown\`, the namespace's production state could not be read (the refusal says why): ` +
  `tell the user, run the tests again in a moment, and do not stop any production to make them run.`;
