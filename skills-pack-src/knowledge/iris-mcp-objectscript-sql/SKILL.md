---
name: iris-mcp-objectscript-sql
description: "Running SQL from ObjectScript with embedded SQL and %SQL.Statement: the SQL table name of a class, SQLCODE 0, 100 and negative values, what INTO variables hold when no row is found, errors that appear only when a statement runs or a row is fetched, NULL against the empty string, and what %OpenId and %DeleteId return for a missing ID. Use when writing or reviewing &sql or %SQL.Statement code, or when a query reports SQLCODE -30 or -29, finds no row you expected, or returns an empty value."
---

Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md

# SQL in ObjectScript

Every behavior below was observed on IRIS 2026.2.

## The table name of a class

- The last dot of a class name separates the schema from the table, and every earlier dot becomes an underscore. `Ens.Request` is the table `Ens.Request`, and `Ens.Config.Item` is the table `Ens_Config.Item`.
- The dotted form of a longer name is read as another table: `SELECT Name FROM Ens.Config.Item` fails with SQLCODE -30, `Table 'CONFIG.ITEM' not found`.
- To look a name up, query `SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?`.

## SQLCODE

- After `&sql(...)`, `SQLCODE` is 0 when the statement worked, 100 when it found or changed no row, and negative for an error, whose text is in `%msg`.
- `If SQLCODE` is true for 100 and for every error alike, so it reports an error as "not found". Test `SQLCODE = 100` and `SQLCODE < 0` apart.
- A successful statement leaves `%msg` as it was, still holding the text of an earlier error. Read `%msg` only when SQLCODE is negative.
- An `UPDATE` or `DELETE` that changes no row gives 100, not an error, and `%ROWCOUNT` is 0. After an `INSERT`, `%ROWID` holds the new row's ID and `%ROWCOUNT` is 1.
- `$$$ThrowSQLIfError(SQLCODE, %msg)` throws a `%Exception.SQL` when SQLCODE is negative and does nothing for 0 or 100. Its `AsStatus()` reads `ERROR #5540: SQLCODE: -400 Message: ...`. Like the status macros, it needs no `Include`.

## Embedded SQL

- `&sql(...)` is compiled the first time it runs, not with the class. A class whose embedded SQL names a missing table or column compiles cleanly, and the statement then sets SQLCODE -30, with `%msg` reading `Table 'MYAPP_DATA.MISSING' not found compiling embedded cached query`, or -29 for a column. A clean compile proves nothing about the SQL inside a class: run it.
- An input host variable that is undefined is read as NULL, with no error. `WHERE Code = :tCode` with `tCode` undefined finds nothing and gives 100.
- When no row is found, every `INTO` variable is set to `""`, including one that held a value or was undefined. A default set before the query does not survive it, so check SQLCODE, not the variable.
- `SELECT COUNT(*) INTO :tCount` always returns one row: SQLCODE is 0, and `tCount` is 0 when nothing matches.
- A `SELECT ... INTO` that matches several rows takes the first one and gives 0. For several rows, use a cursor or `%SQL.Statement`.

```objectscript
ClassMethod FindName(pCode As %String, Output pName As %String) As %Status
{
    Set tSC = $$$OK, pName = ""
    Try {
        &sql(SELECT Name INTO :tName FROM MyApp_Data.Item WHERE Code = :pCode)
        If SQLCODE = 100 {
            Set tSC = $$$ERROR($$$GeneralError, "No item with code "_pCode)
        }
        Else {
            $$$ThrowSQLIfError(SQLCODE, %msg)
            Set pName = tName
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- No row and an SQL error, such as a missing table, each end in `tSC` as a different status, and the method returns once.

## %SQL.Statement

- `%Prepare` returns a `%Status` and does not throw. A missing table fails there, and so does a string in double quotes: SQL reads double quotes as a name, so `WHERE Name = "Apple"` gives `SQLCODE: -29` with `Field 'APPLE' not found`. Write SQL strings in single quotes.
- `%ExecDirect` returns a result object even when the statement fails. Test its `%SQLCODE` and `%Message`, which for a missing table are -30 and `Table ... not found`.
- An error in a selected expression, such as a division by zero, appears only when a row is fetched. `%Execute` leaves `%SQLCODE` at 0. Then `%Next(.tSC)` returns 0, as it does after the last row, with `SQLCODE: -400` and `<DIVIDE>` in `tSC`, and `%SQLCODE` is -400. Check both after the loop, as below.
- After the last row, `%SQLCODE` is 100 and `%ROWCOUNT` is the number of rows fetched.
- Values come back in logical form. A `%Date` column gives a day number such as `67000`, from embedded SQL and from a statement whose `%SelectMode` is its default, 0. Set `%SelectMode = 1` before `%Prepare` to get the ODBC form, `2024-06-09`.
- Pass values as `?` arguments of `%Execute`, never by joining them into the statement text.

```objectscript
ClassMethod ListNames(pMinPrice As %Numeric, Output pNames As %List) As %Status
{
    Set tSC = $$$OK, pNames = ""
    Try {
        Set tStmt = ##class(%SQL.Statement).%New()
        $$$ThrowOnError(tStmt.%Prepare("SELECT Name FROM MyApp_Data.Item WHERE Price > ? ORDER BY Name"))
        Set tRS = tStmt.%Execute(pMinPrice)
        $$$ThrowSQLIfError(tRS.%SQLCODE, tRS.%Message)
        Set tFetch = $$$OK
        While tRS.%Next(.tFetch) {
            Set pNames = pNames_$ListBuild(tRS.%Get("Name"))
        }
        $$$ThrowOnError(tFetch)
        $$$ThrowSQLIfError(tRS.%SQLCODE, tRS.%Message)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- An error from `%Prepare`, such as a missing table, and an error during the fetch each end in `tSC`. No matching row is no error: `pNames` is then an empty list.

## NULL and the empty string

- An ObjectScript `""` in a property is SQL NULL. A saved object whose `Name` is `""` matches `Name IS NULL`, and `INTO` gives back `""`.
- SQL's `''` is another value. It is stored as `$Char(0)`, which `INTO` and the object property both return as a string of length 1, and only `Name = ''` matches it. A property set to `$Char(0)` matches `Name = ''` too.
- To find rows with no value in either form, test `Name IS NULL OR Name = ''`.

## Objects by ID

- `%OpenId(tId)` returns `""` for a missing ID, with no error. Pass a status as the third argument to learn why: `%OpenId(tId, , .tSC)` sets `tSC` to `ERROR #5809: Object to Load not found, class '...', ID '...'`.
- Test the result with `$IsObject`, or the ID with `%ExistsId`, before you use it: `%OpenId(tId).Name` raises `<INVALID OREF>` for a missing ID.
- `%DeleteId(tId)` returns `ERROR #5810: Object to Delete not found` for a missing ID.

## Related skills

- `iris-mcp-objectscript-error-handling`: `%Status` values, exceptions and the `Try` and `Catch` method shape used above.
- `iris-mcp-system-classes`: class queries of the system classes, which run through `%SQL.Statement` too.
