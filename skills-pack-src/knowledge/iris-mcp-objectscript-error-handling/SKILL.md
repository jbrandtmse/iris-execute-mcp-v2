---
name: iris-mcp-objectscript-error-handling
description: "How %Status values and exceptions work in ObjectScript: making, testing, combining and reading a status, the Try and Catch method shape, ThrowOnError, ThrowStatus and AsStatus, what a runtime error looks like inside a Catch, and reading error text without its translated ERROR #N prefix. Use when writing a method that returns %Status, handling, rethrowing or logging an error, converting between exceptions and statuses, or putting error text that IRIS returned into a new error."
---

# %Status and error handling

Every behavior below was observed on IRIS 2026.2.

## What a %Status is

- `$$$OK` is 1. An error status is an encoded string whose numeric value is 0. Test a status with `$$$ISERR(tSC)` or `$$$ISOK(tSC)`, which look at that number, never with `tSC = 1` or by its text.
- Because the test is numeric, any value that does not start with a nonzero number counts as an error: `$$$ISERR("")` and `$$$ISERR("done")` are both 1. Check that a method returns `%Status` before you test its result this way.
- `$$$ERROR($$$GeneralError, "disk full")` makes an error with code 5001. `$System.Status.GetErrorCodes(tSC)` returns `5001`, and `$$$ERRORISTYPE(tSC, $$$GeneralError)` is 1 when the status holds that one error and no other.

## Reading and combining statuses

- `$System.Status.GetErrorText(tSC)` returns `ERROR #5001: disk full`.
- `$$$ADDSC(tSC, tSC2)`, like `$System.Status.AppendStatus`, puts two statuses into one, and `$$$ADDSC($$$OK, tSC2)` is simply `tSC2`. The text of a combined status has one line per error, separated by CR LF. `GetErrorCodes` then returns `5001,5001`, and `$System.Status.GetOneErrorText(tSC, 2)` returns the second line alone.
- `$System.Status.EmbedStatus(tOuter, tInner)` keeps the cause under your own error. Its text reads `ERROR #5001: Import failed`, then a line `  > ERROR #5001: disk full`, and `GetErrorCodes` reports only the outer code. Use it to add context instead of rewriting the inner text.

## The translated prefix

- The word in the prefix depends on the language the text is read in. The same status reads `ERREUR #5001: disk full` from `GetErrorText(tSC, "fr")` and `FEHLER #5001: disk full` from `GetErrorText(tSC, "de")`. So never match the word `ERROR`.
- To get the message without its prefix, cut at the error's own code:

```objectscript
ClassMethod ErrorMessage(pSC As %Status) As %String
{
    Set tText = $System.Status.GetErrorText(pSC)
    Set tTag = " #"_$Piece($System.Status.GetErrorCodes(pSC), ",")_": "
    If $Piece(tText, tTag) '[ " " Set tText = $Piece(tText, tTag, 2, *)
    Quit tText
}
```

- It removes one prefix in any language and keeps the rest of the text as it was. `ERROR #5001: file: missing` becomes `file: missing`, and a message that itself contains `Order #12: ` keeps it. On a combined status only the first line loses its prefix.
- Wrapping the whole text in a new `$$$ERROR($$$GeneralError, ...)` gives `ERROR #5001: ERROR #5001: file: missing`. Wrap the message instead: `$$$ERROR($$$GeneralError, "Import failed: "_..ErrorMessage(tSC))` gives `ERROR #5001: Import failed: file: missing`.

## Exceptions

- `$$$ThrowOnError(expr)` stores the value of `expr` in a local variable named `sc`, then throws a `%Exception.StatusException` when it is an error. It overwrites any `sc` of your own: after `Set sc = "mine"` and `$$$ThrowOnError($$$OK)`, `sc` is 1.
- `$$$ThrowStatus(tSC)` throws a status you already have.
- In `Catch ex`, `ex.AsStatus()` turns any exception into a status. A thrown status comes back unchanged, with its own code and text.
- A runtime error arrives as a `%Exception.SystemException`. For an undefined variable, `ex.Name` is `<UNDEFINED>`, `ex.Code` is 9, `ex.Location` is the line as `label+offset^routine`, and `ex.Data` is the variable name. `ex.AsStatus()` gives code 5002, `ERROR #5002: ObjectScript error: <UNDEFINED>`, followed by the location, a `*` and the variable name. `$ZERROR` holds the same text from `<UNDEFINED>` on.
- `##class(%Exception.General).%New(name, code, location, data)` makes your own exception, but its `code` is only a field: `AsStatus()` always gives `ERROR #5035: General exception Name '...' Code '...' Data '...'`. To raise a status with a code of your choosing, use `$$$ThrowStatus`.
- `Throw ex` inside a `Catch` passes the same exception up to the caller's `Catch`, with its original `Name` and `Location`.
- `$$$QuitOnError(expr)` expands to an argumented `Quit`. Outside `Try` it returns the error status from the method. Inside `Try` or `Catch` it does not compile: `#1043: QUIT argument not allowed : 'sc'`. Use `$$$ThrowOnError` there.
- There is no `Finally` block: `Finally { }` fails to compile with `#1026: Invalid command : 'Finally'`. Code that must run on both paths goes after the `Try` and `Catch` blocks.

## The method shape

```objectscript
ClassMethod Process(pId As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        $$$ThrowOnError(..Validate(pId))
        Set tCount = ..Count(pId)
        If tCount = 0 {
            $$$ThrowStatus($$$ERROR($$$GeneralError, "Nothing to process for "_pId))
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- An error status from `Validate`, the status thrown for an empty count, and a runtime error inside `Count` all end up in `tSC`, and the method returns once, after the blocks.

## Statuses that get lost

- `Do ..Save()` throws away the `%Status` that `Save` returns: the call looks fine and the next line runs. Assign the result and check it, or wrap the call in `$$$ThrowOnError`.
- `%Save()` on a persistent object returns a `%Status` too, so write `$$$ThrowOnError(tObj.%Save())`.

## Related skills

- `iris-mcp-objectscript-gotchas`: language traps such as macros that need an `Include`, extra arguments and namespace switches.
- `iris-mcp-objectscript-unit-tests`: asserting on statuses in `%UnitTest` tests.
