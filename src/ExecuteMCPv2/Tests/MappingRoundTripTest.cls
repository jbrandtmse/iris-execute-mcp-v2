/// Live, CPF-mutating round-trip regression test for global subscript-level
/// mapping handling in <class>ExecuteMCPv2.REST.Config</class>.
/// <p>This class is deliberately kept <b>separate</b> from the fast,
/// deterministic <class>ExecuteMCPv2.Tests.MappingTest</class> suite: each test
/// here calls <method>Config.MapGlobals.Create</method> /
/// <method>Config.MapGlobals.Delete</method>, which rewrite the CPF and take
/// hundreds of milliseconds. Mixing them into the fast suite previously caused
/// the aggregate test-runner poll window to close before the slow tests
/// reported. Run this class on its own (it is small enough not to truncate).</p>
/// <p>It closes the coverage gap flagged in the code review of
/// <code>docs/known-bugs-2026-05-29-mapping-subscript.md</code>: the decision
/// logic (<method>ExecuteMCPv2.REST.Config.BuildMappingName</method> and
/// <method>IsGuardedBaseMapping</method>) is unit-tested in
/// <class>ExecuteMCPv2.Tests.MappingTest</class>, but the actual persisted-state
/// outcome — a subscript create/delete operating on the NODE and leaving the
/// BASE mapping intact — was previously only verified manually. These tests
/// assert that outcome automatically.</p>
/// <p>All operations use a throwaway global name (<code>ZZMAPRTTEST</code>) that
/// does not exist as a real global, mapped to <code>IRISSYS</code>; nothing real
/// is affected, and every test cleans up its own mappings before and after.</p>
Class ExecuteMCPv2.Tests.MappingRoundTripTest Extends %UnitTest.TestCase
{

/// Throwaway global name — does not exist as a real global; mapping it is harmless.
Parameter TESTGLOBAL = "ZZMAPRTTEST";

/// Subscript node used for the subscript-level mapping.
Parameter TESTSUB = "(""ABC"")";

/// Database the throwaway mappings target (always present on any IRIS instance).
Parameter TESTDB = "IRISSYS";

/// Constructor — must accept and forward initvalue to the parent.
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Remove any residue from a prior aborted run before each test.
Method OnBeforeOneTest(testname As %String) As %Status
{
    Do ..CleanupMappings($NAMESPACE)
    Quit $$$OK
}

/// Always clean up after each test — pass or fail.
Method OnAfterOneTest(testname As %String) As %Status
{
    Do ..CleanupMappings($NAMESPACE)
    Quit $$$OK
}

/// End-to-end round trip. Regression #1: creating a subscript-level mapping
/// creates the NODE and leaves the BASE mapping intact. Regression #2: deleting
/// by subscript removes only the NODE and leaves the BASE intact. Inverts the
/// exact failure mode of the bug (old handler ignored the subscript and operated
/// on the base global instead).
Method TestSubscriptRoundTripPreservesBase() As %Status
{
    Set tNS = $NAMESPACE
    Set tBase = ..#TESTGLOBAL
    Set tDB = ..#TESTDB

    ; Compose the node name through the handler's own composer.
    Set tEff = ..Compose(tBase, ..#TESTSUB, .tSC)
    Do $$$AssertStatusOK(tSC, "BuildMappingName should compose the node name")
    Do $$$AssertNotEquals(tEff, tBase, "Composed node name must differ from the base name")

    ; 1) Create a base mapping for the throwaway global.
    Set tSC = ..CreateMapping(tNS, tBase, tDB)
    Do $$$AssertStatusOK(tSC, "Base mapping create should succeed")
    Do $$$AssertTrue(..MappingExists(tNS, tBase), "Base mapping should exist after its create")

    ; 2) Create the subscript-level mapping for the SAME global.
    Set tSC = ..CreateMapping(tNS, tEff, tDB)
    Do $$$AssertStatusOK(tSC, "Subscript mapping create should succeed")

    ; 3) Regression #1: the NODE mapping exists with the requested target, AND
    ;    the BASE mapping is still present (not clobbered by the subscript create).
    Do $$$AssertTrue(..MappingExists(tNS, tEff), "Subscript node mapping should exist after create")
    Do $$$AssertEquals(..MappingDatabase(tNS, tEff), tDB, "Subscript node should map to the requested database")
    Do $$$AssertTrue(..MappingExists(tNS, tBase), "Base mapping must remain intact after the subscript create")

    ; 4) Delete the subscript node only.
    Set tSC = ..DeleteMapping(tNS, tEff)
    Do $$$AssertStatusOK(tSC, "Subscript node delete should succeed")

    ; 5) Regression #2: the NODE is gone, the BASE still remains (the old delete
    ;    bug removed the base instead of the node).
    Do $$$AssertTrue('..MappingExists(tNS, tEff), "Subscript node mapping should be gone after delete")
    Do $$$AssertTrue(..MappingExists(tNS, tBase), "Base mapping must remain after deleting only the subscript node")

    Quit $$$OK
}

/// Compose an effective mapping name via the handler's BuildMappingName, run
/// from %SYS (its validator lives there) and ALWAYS restore the caller's
/// namespace. The %Status is returned by reference in <var>pSC</var>.
ClassMethod Compose(pName As %String, pSubscript As %String, Output pSC As %Status) As %String [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tEff = pName
    Set pSC = $$$OK
    Try {
        Set $NAMESPACE = "%SYS"
        Set pSC = ##class(ExecuteMCPv2.REST.Config).BuildMappingName("global", pName, pSubscript, 5, .tEff)
    }
    Catch ex {
        Set pSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrig
    Quit tEff
}

/// Create a global mapping (Config ops run in %SYS), always restoring NS.
ClassMethod CreateMapping(pNamespace As %String, pName As %String, pDatabase As %String) As %Status [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tSC = $$$OK
    Try {
        Set $NAMESPACE = "%SYS"
        Kill tProps
        Set tProps("Database") = pDatabase
        Set tSC = ##class(Config.MapGlobals).Create(pNamespace, pName, .tProps)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrig
    Quit tSC
}

/// Delete a global mapping (Config ops run in %SYS), always restoring NS.
ClassMethod DeleteMapping(pNamespace As %String, pName As %String) As %Status [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tSC = $$$OK
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.MapGlobals).Delete(pNamespace, pName)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrig
    Quit tSC
}

/// Existence check via the same Config.MapGlobals:List query the handler uses
/// (its Name column carries the full subscript node name). Runs in %SYS,
/// restores NS.
ClassMethod MappingExists(pNamespace As %String, pName As %String) As %Boolean [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tFound = 0
    Try {
        Set $NAMESPACE = "%SYS"
        Set tRS = ##class(%ResultSet).%New("Config.MapGlobals:List")
        Do tRS.Execute(pNamespace)
        While tRS.Next() {
            If tRS.Get("Name") = pName {
                Set tFound = 1
                Quit
            }
        }
        Do tRS.Close()
    }
    Catch ex {
        Set tFound = 0
    }
    Set $NAMESPACE = tOrig
    Quit tFound
}

/// Return the Database a mapping targets (empty string if it does not exist).
/// Runs in %SYS, restores NS.
ClassMethod MappingDatabase(pNamespace As %String, pName As %String) As %String [ Internal ]
{
    Set tOrig = $NAMESPACE
    Set tDB = ""
    Try {
        Set $NAMESPACE = "%SYS"
        Kill tProps
        Set tSC = ##class(Config.MapGlobals).Get(pNamespace, pName, .tProps)
        If $$$ISOK(tSC) Set tDB = $Get(tProps("Database"))
    }
    Catch ex {
        Set tDB = ""
    }
    Set $NAMESPACE = tOrig
    Quit tDB
}

/// Remove both the node and base throwaway mappings; ignore errors.
ClassMethod CleanupMappings(pNamespace As %String) [ Internal ]
{
    Set tOrig = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Do ##class(Config.MapGlobals).Delete(pNamespace, ..#TESTGLOBAL _ ..#TESTSUB)
        Do ##class(Config.MapGlobals).Delete(pNamespace, ..#TESTGLOBAL)
    }
    Catch ex {
    }
    Set $NAMESPACE = tOrig
    Quit
}

}
