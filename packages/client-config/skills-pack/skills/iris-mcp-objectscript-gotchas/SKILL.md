---
name: iris-mcp-objectscript-gotchas
description: "ObjectScript language traps that compile or run differently from what the code suggests: which macros a class gets without an Include, extra arguments, JSON null against a missing key in a dynamic object, object references inside $List, numeric-looking subscripts, New $NAMESPACE and Catch blocks, missing Ens classes, and Open timeouts. Use when writing, reviewing or debugging ObjectScript, or when IRIS reports MPP5610, PARAMETER, INVALID CLASS, INVALID OREF or CLASS DOES NOT EXIST and the cause is not obvious."
---

# ObjectScript gotchas

Each section names the error or the wrong value you see, then its cause and the fix. Every behavior below was observed on IRIS 2026.2.

## Macros and include files

- `$$$Name` is a macro, which the compiler expands before the code runs. `$$Name` calls the label `Name` as a function, and `$Name` is a system function such as `$Piece`.
- Every class gets the status macros without an `Include`: `$$$OK`, `$$$ERROR`, `$$$ISERR`, `$$$ISOK`, `$$$ADDSC`, `$$$ThrowOnError`, `$$$ThrowStatus` and `$$$QuitOnError`.
- Error-code macros are different. Inside `$$$ERROR($$$GeneralError, "text")` the code name works in any class, because `$$$ERROR` looks the name up itself. On its own, as in `Set tCode = $$$GeneralError`, it needs `Include %occErrors` above the `Class` line. Without it the compile fails with `MPP5610 : Referenced macro not defined: 'GeneralError'`.
- The `$$$Assert` macros work only in the instance methods of a `%UnitTest.TestCase` subclass, because each macro calls an instance method of the test case. In a class method of a test case the compile fails with `MPP5377 : You are attempting to call instance method 'AssertEqualsViaMacro' from a class method`.
- In any other class the compile fails with `MPP5610` for the macro. Adding `Include %outUnitTest` does not help: the compile then fails with `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist` in an instance method, and with `MPP5392 : No such method 'AssertEqualsViaMacro' defined in this class` in a class method.

## Calls and arguments

- A call with more arguments than the method declares compiles, then raises `<PARAMETER>` when it runs. Read the signature of a method you have not used before you call it, rather than guessing from a similar one.
- A call with fewer arguments is legal. A missing argument takes its default; with no default it is undefined, so `$Data(pB)` is 0.

## Dynamic objects

- `$Get(tObj.%Get("x"), "d")` fails with `<INVALID CLASS> Class '%Library.DynamicObject' does not support MultiDimensional operations`, because `$Get` treats its first argument as a variable. Use `tObj.%Get("x", "d")`.
- That default covers only a missing key. A key that holds JSON `null` returns `""`, not the default, and `%IsDefined` is 1 for it.
- To tell a missing key from `null` and from an empty string, use `%GetTypeOf(key)`, which returns `"unassigned"`, `"null"` and `"string"` for the three.
- A key that contains `_` needs quotes only in property syntax: `Set tObj."max_results" = 5`. `%Get("max_results")` and `%Set("page_size", 10)` take the key as a string and need nothing more.

## Object references in lists and arrays

- `$ListBuild(tObj)` stores the reference as a string such as `5143@%Library.ListOfDataTypes`. `$ListGet` gives back that string: `$IsObject` on it is 0, and calling a method on it raises `<INVALID OREF>`.
- Keep references in a local array, `Set tItems(1) = tObj`, or in a `%DynamicArray`, `Do tArr.%Push(tObj)`. Both give back an object you can use.

## Subscripts

- A string subscript that is a canonical number is that number: `tA("1")` and `tA(1)` are one node.
- `"01"` and `"1.0"` are not canonical numbers, so `tA("01")` and `tA("1.0")` are separate nodes. A numeric literal is made canonical first, so `tA(1.0)` is `tA(1)`.
- `$Order` returns numeric subscripts first, in numeric order, and then strings in string order: `1`, `2`, `10`, `"01"`, `"b"`.

## Namespaces

- `New $NAMESPACE` undoes a namespace switch when the method returns, not when its `Try` block ends. A `Catch` in the same method still runs in the namespace you switched to.
- So put the work for the other namespace in a method of its own that starts with `New $NAMESPACE`. Its caller, and the caller's `Catch`, stay in the original namespace. Otherwise, save `$NAMESPACE` in a local variable and set it back yourself, first thing in every `Catch`.
- Not every namespace has the `Ens.*` classes, and `%SYS` has none. Before you call one from code that can run elsewhere, check `##class(%Dictionary.CompiledClass).%ExistsId("Ens.Director")`, which is 1 where the class is compiled and 0 in `%SYS`.

## Open and $Test

- `Open` sets `$Test` only when you give it a timeout. `Open tFile::5` sets `$Test` to 1 when the device opened within 5 seconds and to 0 when it did not.
- Without a timeout, `Open` leaves `$Test` as an earlier command set it, 0 or 1, so a check of `$Test` after it tests something else.
- The arguments of `Open` are positional: device, parameters, timeout, mnemonic space. In `Open tFile:::1` the `1` is the mnemonic space, so that `Open` has no timeout and sets no `$Test`.

## Related skills

- `iris-mcp-objectscript-error-handling`: `%Status` values, exceptions and the `Try` and `Catch` method shape.
- `iris-mcp-objectscript-unit-tests`: writing and running `%UnitTest` test classes.
