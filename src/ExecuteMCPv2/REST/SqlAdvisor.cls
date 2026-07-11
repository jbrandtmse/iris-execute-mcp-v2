/// REST handler for the SQL Performance Advisor data endpoint (Epic 28, Story 28.1).
/// <p>Backs the custom REST endpoint <code>/api/executemcp/v2/dev/sql/advise-data</code>
/// (<method>AdviseData</method>, POST JSON body). Given a SQL <var>query</var>, returns
/// in ONE round-trip: the verbatim server-side <code>EXPLAIN &lt;query&gt;</code> plan
/// text, the <code>%Dictionary.CompiledIndex</code> rows for every table the plan
/// references (grouped per table), and the enumerated <code>{schema, table, className}</code>
/// list — so <code>iris_sql_analyze</code>'s <code>advise</code> action (Story 28.3) has
/// every raw material the TS heuristic engine (Story 28.2) needs from one call. No
/// separate tune-metadata payload is needed: <code>stale-stats</code> is read straight
/// off the plan's own <code>Warning:\nTable X is not tuned.</code> block, which is
/// preserved verbatim in <code>plan</code> (Story 28.0 finding).</p>
/// <p><b>EXPLAIN API (Rule #16 PROBE-PINNED, live-verified against
/// <code>Ens.Config.Item</code> on IRIS 2026.1 Build 235U, HSCUSTOM):</b>
/// <code>##class(%SQL.Statement).%ExecDirect(, "EXPLAIN "_query)</code>, reading the
/// first row's <code>Plan</code> column, produces BYTE-FOR-BYTE the SAME plan text as
/// the existing <code>iris_sql_analyze</code> <code>explain</code> action's
/// <code>action/query</code> Atelier call (confirmed identical for
/// <code>EXPLAIN SELECT ID, Name FROM Ens_Config.Item WHERE Name = 'X'</code> via both
/// paths). A prepare-time failure (bad syntax, unsupported statement type) does NOT
/// throw — it returns a negative <code>%SQLCODE</code> with a <code>%Message</code>
/// on the <class>%SQL.StatementResult</class> (confirmed live: <code>EXPLAIN</code> of a
/// non-SELECT statement returns <code>SQLCODE -481</code>; malformed non-SQL text
/// returns <code>SQLCODE -204</code>) — both surfaced here as a clean <method>
/// ExecuteMCPv2.Utils:SanitizeError</method> envelope, never a raw dump.</p>
/// <p>This is a pure PRODUCER (Rule #47 correction — the first ObjectScript handler for
/// the <code>iris_sql_analyze</code> tool family; the existing four actions are
/// TS/SQL-only via <code>action/query</code>, settled in Story 28.0). No TS tool wiring,
/// no governance key, and no consumer ships in this story — Story 28.3's <code>advise</code>
/// action is the first live caller; Story 28.2 captures reference fixtures from this
/// endpoint's live output.</p>
Class ExecuteMCPv2.REST.SqlAdvisor Extends %Atelier.REST
{

/// SQL advisor data endpoint: EXPLAIN plan text + index/class dictionary rows for the
/// table(s) a query references, in one response (Story 28.1, AC 28.1.1).
/// <p>JSON body: <code>{ "query": "&lt;sql&gt;", "namespace"?: "&lt;ns&gt;" }</code>.
/// <var>query</var> is REQUIRED and is validated BEFORE any namespace switch (per AC
/// 28.1.1). When <var>namespace</var> is supplied, the read runs there via explicit
/// save/restore (never <code>New $NAMESPACE</code>) because <code>EXPLAIN</code> and
/// <code>%Dictionary.*</code> reads are namespace-local dictionary reads, not
/// <code>%SYS</code>-scoped.</p>
/// <p>Response shape: <code>{ "plan": "&lt;verbatim EXPLAIN text&gt;",
/// "tables": [ {"schema","table","className"}, ... ],
/// "indexes": [ {"className","schema","table","rows":[{"indexName","properties",
/// "primaryKey","isUnique","type","data"}, ...]}, ... ] }</code>. A table token found
/// in the plan that does not resolve to a compiled class is still listed in
/// <code>tables</code> (with an empty <code>className</code>) but contributes no
/// <code>indexes</code> entry — no silent empty (spec §3). A malformed/non-preparable
/// <var>query</var> surfaces the IRIS error via <method>ExecuteMCPv2.Utils:SanitizeError
/// </method> — this endpoint never guesses at an unrecognized plan shape (that is the
/// Story 28.2 TS engine's job).</p>
ClassMethod AdviseData() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tOrigNS = $NAMESPACE
    Set tErrored = 0
    Try {
        Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC1) {
            Set tErrored = 1
            Set tCmdStatus = tSC1
            Quit
        }

        Set tQuery = "", tNamespace = ""
        If $IsObject(tBody) {
            If tBody.%IsDefined("query") Set tQuery = tBody.%Get("query")
            If tBody.%IsDefined("namespace") Set tNamespace = tBody.%Get("namespace")
        }
        Set tQuery = $ZStrip(tQuery, "<>W")

        ; validate query BEFORE any namespace switch (AC 28.1.1)
        Set tSC2 = ##class(ExecuteMCPv2.Utils).ValidateRequired(tQuery, "query")
        If $$$ISERR(tSC2) {
            Set tErrored = 1
            Set tCmdStatus = tSC2
            Quit
        }

        ; switch to the target namespace (explicit save/restore — Rule #7)
        If tNamespace '= "" {
            Set tSC3 = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC3) {
                Set tErrored = 1
                Set tCmdStatus = tSC3
                Quit
            }
        }

        Set tSC4 = ..BuildAdviceData(tQuery, .tResult)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC4) {
            Set tErrored = 1
            Set tCmdStatus = tSC4
            Quit
        }
        Quit
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// Core advisor-data logic (Rule #7's <var>%request</var>-independent seam — unit
/// -testable directly, no live CSP context required). Operates in the CURRENT
/// namespace (the caller switches beforehand, mirroring
/// <class>ExecuteMCPv2.REST.EnvSync</class>'s "current namespace" contract).
/// Validates <var>pQuery</var> is present, runs <code>EXPLAIN</code>, extracts the
/// referenced table(s) from the plan text, and enumerates each table's compiled
/// indexes.
ClassMethod BuildAdviceData(pQuery As %String, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Try {
        Set tQuery = $ZStrip(pQuery, "<>W")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tQuery, "query")
        If $$$ISERR(tSC) Quit

        Set tPlanText = ""
        Set tSC = ..RunExplain(tQuery, .tPlanText)
        If $$$ISERR(tSC) Quit

        Set tSC = ..ExtractTables(tPlanText, .tTables)
        If $$$ISERR(tSC) Quit

        Set tTablesArr = []
        Set tIndexesArr = []
        Set tTableCount = +$Get(tTables)
        For tI = 1:1:tTableCount {
            Set tSchema = tTables(tI, "schema")
            Set tTable = tTables(tI, "table")
            Set tClassName = ..ResolveClassForTable(tSchema, tTable)

            Set tTableEntry = {}
            Do tTableEntry.%Set("schema", tSchema)
            Do tTableEntry.%Set("table", tTable)
            Do tTableEntry.%Set("className", tClassName)
            Do tTablesArr.%Push(tTableEntry)

            If tClassName = "" Continue

            Set tSC = ..IndexRowsForClass(tClassName, .tIdxRows)
            If $$$ISERR(tSC) Quit

            Set tRowsArr = []
            Set tIdxCount = +$Get(tIdxRows)
            For tJ = 1:1:tIdxCount {
                Set tIdxEntry = {}
                Do tIdxEntry.%Set("indexName", tIdxRows(tJ, "indexName"))
                Do tIdxEntry.%Set("properties", tIdxRows(tJ, "properties"))
                Do tIdxEntry.%Set("primaryKey", tIdxRows(tJ, "primaryKey"), "boolean")
                Do tIdxEntry.%Set("isUnique", tIdxRows(tJ, "isUnique"), "boolean")
                Do tIdxEntry.%Set("type", tIdxRows(tJ, "type"))
                Do tIdxEntry.%Set("data", tIdxRows(tJ, "data"))
                Do tRowsArr.%Push(tIdxEntry)
            }

            Set tGroupEntry = {}
            Do tGroupEntry.%Set("className", tClassName)
            Do tGroupEntry.%Set("schema", tSchema)
            Do tGroupEntry.%Set("table", tTable)
            Do tGroupEntry.%Set("rows", tRowsArr)
            Do tIndexesArr.%Push(tGroupEntry)
        }
        If $$$ISERR(tSC) Quit

        Set pResult = {}
        Do pResult.%Set("plan", tPlanText)
        Do pResult.%Set("tables", tTablesArr)
        Do pResult.%Set("indexes", tIndexesArr)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Run <code>EXPLAIN &lt;pQuery&gt;</code> via <class>%SQL.Statement</class> and return
/// the verbatim <code>Plan</code> column text (Rule #16 PROBE-PINNED — see class doc
/// comment). A prepare-time failure does not throw; it surfaces as a negative
/// <var>%SQLCODE</var> with a <var>%Message</var> on the result object, which this
/// method converts into a <class>%Status</class> error (the caller sanitizes it).
ClassMethod RunExplain(pQuery As %String, Output pPlanText As %String) As %Status
{
    Set tSC = $$$OK
    Set pPlanText = ""
    Try {
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "EXPLAIN "_pQuery)
        If '$IsObject(tRS) {
            Set tSC = $$$ERROR($$$GeneralError, "EXPLAIN did not return a result")
            Quit
        }
        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "EXPLAIN failed: "_tRS.%Message)
            Quit
        }
        If tRS.%Next() {
            Set pPlanText = tRS.Plan
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Extract the distinct <code>{schema, table}</code> tokens a plan actually reads,
/// parsed from its <code>Read master map &lt;Schema&gt;.&lt;Table&gt;.IDKEY</code> and
/// <code>Read index map &lt;Schema&gt;.&lt;Table&gt;.&lt;IndexName&gt;</code> marker
/// lines (Story 28.0 pinned marker strings). A join alias in parens (e.g.
/// <code>AdvisorProbeChild(C).IDKEY</code>) is stripped before splitting. Temp-file /
/// intermediate-build plans (<code>GROUP BY</code>/<code>ORDER BY</code>/joins) still
/// nest a <code>Read master map</code> line for each underlying table inside the
/// temp-file-populating module (confirmed live, Story 28.0 findings 3–4), so this single
/// pass over both marker types handles multi-table joins without special-casing the
/// temp-file vocabulary itself. <var>pTables</var> — output: <var>pTables</var> = count,
/// <var>pTables</var>(1..n,"schema"/"table") = the parallel schema/table strings, in
/// first-seen order, de-duplicated.
ClassMethod ExtractTables(pPlanText As %String, Output pTables) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pTables
        Set pTables = 0
        Set tSeen = ","
        Set tNorm = $Replace(pPlanText, $Char(13), "")
        Set tLineCount = $Length(tNorm, $Char(10))
        For tI = 1:1:tLineCount {
            Set tLine = $Piece(tNorm, $Char(10), tI)
            Set tMarker = ""
            If tLine [ "Read master map " { Set tMarker = "Read master map " }
            ElseIf tLine [ "Read index map " { Set tMarker = "Read index map " }
            If tMarker = "" Continue

            Set tAfter = $Piece(tLine, tMarker, 2)
            Set tToken = $ZStrip($Piece(tAfter, ",", 1), "<>W")
            ; strip a parenthetical join alias, e.g. "Table(C).IDKEY" -> "Table.IDKEY"
            If tToken [ "(" {
                Set tToken = $Piece(tToken, "(", 1) _ $Piece(tToken, ")", 2)
            }
            Set tSchema = $Piece(tToken, ".", 1)
            Set tTable = $Piece(tToken, ".", 2)
            If (tSchema = "") || (tTable = "") Continue

            Set tKey = tSchema_"."_tTable
            If tSeen [ (","_tKey_",") Continue
            Set tSeen = tSeen_tKey_","

            Set pTables = pTables + 1
            Set pTables(pTables, "schema") = tSchema
            Set pTables(pTables, "table") = tTable
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Resolve a SQL <var>pSchema</var>/<var>pTable</var> pair to its compiled DOT-form
/// class name via <code>%Dictionary.CompiledClass</code> (Story 28.0 pinned query).
/// Returns <code>""</code> when no compiled class maps to that schema/table (e.g. a
/// view or an unresolvable plan token) — the caller lists the table with an empty
/// <code>className</code> rather than treating this as an error.
ClassMethod ResolveClassForTable(pSchema As %String, pTable As %String) As %String
{
    Set tClassName = ""
    Try {
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Name FROM %Dictionary.CompiledClass WHERE SqlSchemaName = ? AND SqlTableName = ?", pSchema, pTable)
        If $IsObject(tRS) && (tRS.%SQLCODE >= 0) && tRS.%Next() {
            Set tClassName = tRS.Name
        }
    } Catch {
        Set tClassName = ""
    }
    Quit tClassName
}

/// Enumerate <var>pClassName</var>'s compiled indexes via <code>%Dictionary.
/// CompiledIndex</code> (Story 28.0 pinned query + ROWSPEC — Rules #2/#4/#16).
/// <var>properties</var> is the verbatim, order-preserving <code>Prop:Collation,…</code>
/// string (the leading-subscript source for the Story 28.2 <code>missing-index</code>
/// heuristic) — never reformatted here. <var>pRows</var> — output: <var>pRows</var> =
/// count, <var>pRows</var>(1..n,"indexName"/"properties"/"primaryKey"/"isUnique"/
/// "type"/"data").
ClassMethod IndexRowsForClass(pClassName As %String, Output pRows) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pRows
        Set pRows = 0
        Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT parent AS ClassName, Name AS IndexName, Properties AS PropertyList, PrimaryKey, ""_Unique"" AS IsUnique, Type, Data FROM %Dictionary.CompiledIndex WHERE parent = ? ORDER BY Name", pClassName)
        If '$IsObject(tRS) {
            Set tSC = $$$ERROR($$$GeneralError, "Index dictionary query did not return a result")
            Quit
        }
        If tRS.%SQLCODE < 0 {
            Set tSC = $$$ERROR($$$GeneralError, "Index dictionary query failed: "_tRS.%Message)
            Quit
        }
        While tRS.%Next() {
            Set pRows = pRows + 1
            Set pRows(pRows, "indexName") = tRS.IndexName
            Set pRows(pRows, "properties") = tRS.PropertyList
            Set pRows(pRows, "primaryKey") = +tRS.PrimaryKey
            Set pRows(pRows, "isUnique") = +tRS.IsUnique
            Set pRows(pRows, "type") = tRS.Type
            Set pRows(pRows, "data") = tRS.Data
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
