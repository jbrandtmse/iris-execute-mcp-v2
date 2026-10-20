## ObjectScript pre-write checklist

Before writing ObjectScript, on disk or on the server, check:

**Syntax and names**

- Macros take three dollar signs: `$$$OK`. `$$OK` calls a label and fails to compile with `<NOLINE>`.
- Indent every command in a method; a command in column 1 is read as a label.
- No `_` in class, method, property or parameter names. It is the concatenation operator, so the class does not compile.
- Quote a dynamic-object key that contains `_`: `Set obj."max_results" = 5`.

**Control flow and errors**

- `Quit` with a value does not compile inside `Try` or `Catch`. Use `Return value`, or `Quit` a variable after the block.
- An argumentless `Quit` in `Catch` leaves only the `Catch` block, and the code after it still runs: set a flag, and act on it after the block.
- `$System.Status.GetErrorText(tSC)` already starts with a prefix such as `ERROR #5001: `. Strip it before wrapping the text in `$$$ERROR` again, or it appears twice.
- Never wrap a method call in `$Get()`: `$Get(obj.%Get("x"), d)` fails with `<INVALID CLASS>`. Use `obj.%Get("x", d)` or `obj.%IsDefined("x")`.

**Namespaces and output**

- After `Set $NAMESPACE = "%SYS"`, a class that `%SYS` cannot see raises `<CLASS DOES NOT EXIST>`. Save the original, and restore it first in every `Catch`.
- Stop capturing output with `##class(%Library.Device).ReDirectIO(0)`, then `Use` the original device. `Use dev::("")` leaves redirection on, and the next `Write` fails with `<COMMAND>`.

**Classes**

- Never hand-edit a `Storage` block. The compiler writes it.
- An abstract method still needs a `{ }` body, which may be empty.

**Unit tests**

- Assertions are macros: `Do $$$AssertEquals(...)`, plus `$$$AssertNotEquals`, `$$$AssertTrue`, `$$$AssertNotTrue`, `$$$AssertStatusOK` and `$$$AssertStatusNotOK`. There is no `$$$AssertFalse` or `$$$AssertCondition`.
- Only methods whose names start with `Test` run.
- A `%OnNew` in a `%UnitTest.TestCase` subclass takes `initvalue`, calls `##super(initvalue)`, and is not `Private`.
- Compare a run's total with the `Test` methods you expect. A class that cannot start reports 0.
