---
name: iris-mcp-objectscript-unit-tests
description: "Writing and running %UnitTest tests in ObjectScript: the TestCase class shape and its setup and teardown hooks, which methods run and in what order, the common Assert macros and what they return, skipping a test, what happens when setup or a test fails, and running a class with %UnitTest.Manager and checking its totals. Use when creating or editing a %UnitTest.TestCase class, running IRIS unit tests, or when a run reports fewer tests than expected, zero tests, or a failure you cannot explain."
---

# %UnitTest in ObjectScript

Every behavior below was observed on IRIS 2026.2.

## A test class

```objectscript
Class MyApp.Tests.Cart Extends %UnitTest.TestCase
{

Property Cart As %DynamicObject;

Method OnBeforeOneTest(testname As %String) As %Status
{
    Set ..Cart = {"items":[{"price":2},{"price":3}]}
    Quit $$$OK
}

Method OnAfterOneTest(testname As %String) As %Status
{
    Set ..Cart = ""
    Quit $$$OK
}

Method TestItemCount()
{
    Do $$$AssertEquals(..Cart.items.%Size(), 2, "two items")
}

Method TestTotal()
{
    Set tTotal = 0
    Set tIter = ..Cart.items.%GetIterator()
    While tIter.%GetNext(.tKey, .tItem) {
        Set tTotal = tTotal + tItem.price
    }
    Do $$$AssertEquals(tTotal, 5, "prices add up")
}

}
```

- Tests are instance methods with no arguments. `OnBeforeAllTests()` and `OnAfterAllTests()` run once for the class, and `OnBeforeOneTest(testname)` and `OnAfterOneTest(testname)` run around each test. Each hook returns a `%Status`.
- One test-case object serves every test of the class, so a property that one test sets is still set in the next. Reset shared state in `OnBeforeOneTest`, as above.
- Put setup in the hooks, not in `%OnNew`. The manager passes itself to `%New`, and the constructor of `%UnitTest.TestCase` keeps it for the assertion macros. An `%OnNew` that does not call `##super(initvalue)` leaves it unset, and the first assertion fails with `<INVALID OREF>`.

## Which methods run, and in what order

- Every method whose name starts with `Test` runs as a test. That includes a helper named `TestingHelper`, so give helpers another name. The match is case-sensitive: `testLowerCase` never runs.
- The order is fixed. Names with a number right after `Test` run first, by that number, so `Test2` runs before `Test10`. The other names follow in string order.
- Write each test so it passes alone. A run can target a single method, and a test that relies on what an earlier test left behind fails when it runs by itself. Create what a test needs in `OnBeforeOneTest` and remove it in `OnAfterOneTest`.

## Assertions

| Macro | Passes when |
| --- | --- |
| `$$$AssertEquals(a, b, msg)` | `a = b` |
| `$$$AssertNotEquals(a, b, msg)` | `a '= b` |
| `$$$AssertTrue(cond, msg)` | `cond` is true |
| `$$$AssertNotTrue(cond, msg)` | `cond` is false |
| `$$$AssertStatusOK(sc, msg)` | `sc` is OK |
| `$$$AssertStatusNotOK(sc, msg)` | `sc` is an error |
| `$$$AssertStatusEquals(sc1, sc2, msg)` | both are OK, or both hold the same errors with the same arguments |
| `$$$AssertSuccess(msg)` | always; it records a pass |
| `$$$AssertFailure(msg)` | never; it records a failure |
| `$$$AssertSkipped(msg)` | it marks the test skipped |
| `$$$LogMessage(msg)` | it is a note in the log, not an assertion |

- `$$$AssertFilesSame(file1, file2, msg)` compares two files.
- The description is optional in every assertion except `$$$AssertSkipped`, where leaving it out fails the test with `<UNDEFINED>`. A comparison without a description logs its expression instead, such as `1 + 1== 2`.
- `$$$AssertEquals` compares with `=`, which compares strings: `"1.0"` and `1` are not equal, while `+"1.0"` and the literal `1.0` both equal `1`.
- An assertion returns 1 when it passes and 0 when it fails, so it can guard the rest of a test: `If '$$$AssertStatusOK(tSC, "saved") Quit`.
- A failed assertion does not end the test. The method goes on with its next line, and the test is reported failed when it ends.

## Skipped tests and failed setup

- `$$$AssertSkipped(reason)` in `OnBeforeOneTest` skips that test: its method does not run, and it is reported skipped. Inside a test, call it and then `Quit`; the test is reported skipped too.
- In `OnBeforeAllTests`, `$$$AssertSkipped` does not skip the class. The first test does not run, yet it is reported passed, and the other tests run as usual. Skip from `OnBeforeOneTest` instead.
- An error status from `OnBeforeOneTest` fails that one test without running it.
- When `OnBeforeOneTest` returns an error or skips its test, `OnAfterOneTest` is not called for that test, so undo anything it had already set up before it returns. A test that fails, even with a runtime error, still gets its `OnAfterOneTest`.
- An error status from `OnBeforeAllTests` stops the whole class. None of its tests runs: the class is reported failed with that error, and it has no `TestMethod` rows.
- A runtime error in a test, such as `<UNDEFINED>`, ends and fails that test with `ERROR #5002: ObjectScript error: <UNDEFINED>` and the location. The next test still runs.

## Running tests

- `##class(%UnitTest.Manager).RunTest(testspec, qspec)` runs tests and returns a `%Status`.
- The testspec is a suite, a class and a method, separated by colons. `":MyApp.Tests.Cart"` runs one class, and `":MyApp.Tests.Cart:TestTotal"` runs one method of it.
- For classes already compiled on the server, pass `"/noload/nodelete/norecursive"`. The default, `/load`, first loads the classes from the test directory, and a run that loads and runs them deletes the loaded classes when it finishes unless `/nodelete` is given.
- `RunTest` checks that `^UnitTestRoot` names a directory that exists. It is a global, so each namespace has its own: set it in the namespace where the tests run.
- Results stay in that namespace and can be read with SQL from `%UnitTest_Result.TestInstance`, `TestSuite`, `TestCase`, `TestMethod` and `TestAssert`. `TestMethod.Status` is 1 for passed, 0 for failed and 2 for skipped.
- `TestAssert` holds a row for each assertion, and also one for each `$$$LogMessage` and a `Duration of execution` row for each test method that runs without a runtime error. Those two kinds have the `Action` `LogMessage`, so count assertions by `Action`, not by rows.
- After a run, compare the number of test methods reported for each class with the number of `Test` methods in it. When the count is short, the run's `TestMethod` rows show which tests never ran.

## Related skills

- `iris-mcp-objectscript-error-handling`: making and checking the `%Status` values that tests assert on.
- `iris-mcp-objectscript-gotchas`: language traps such as macros that work only in a test class.
