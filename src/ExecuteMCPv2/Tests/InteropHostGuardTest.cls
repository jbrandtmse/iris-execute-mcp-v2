/// QA-stage coverage for the CR 18.0-1 add-branch host-class guard in
/// <method>ExecuteMCPv2.REST.Interop:ItemManage</method> (the <code>add</code> action,
/// lines ~534-577). That guard rejects a config-item <code>className</code> that is not a
/// usable Ens.Host business host BEFORE persisting it, in this decision order:
/// <ol>
///   <li>strip surrounding whitespace; an all-whitespace name is empty and rejected;</li>
///   <li><code>%Dictionary.CompiledClass.%ExistsId</code> — must be compiled (CR 17.2-3);</li>
///   <li><code>$classmethod(cls,"%Extends","Ens.Host")</code> — must extend Ens.Host
///       (CR 18.0-1, part a);</li>
///   <li><code>%Dictionary.CompiledClass.%OpenId(cls).Abstract</code> — must NOT be abstract
///       (CR 18.0-1, part b).</li>
/// </ol>
/// <p>The guard's live-HTTP REJECTION is exercised by the Story 22.1 lead smoke (AC 22.1.8,
/// Rule #26 — direct POST, response envelope unchanged, no write). This class complements
/// that with an OS-level, default-suite regression pin of the underlying IRIS-class
/// classification the guard depends on: <method>ClassifyHost</method> runs the SAME primitives
/// in the SAME order, and the representative-class verdicts below are the exact facts the dev
/// probed live (Dev Agent Record). If a future IRIS upgrade or class change altered a
/// representative host's abstractness or hierarchy — silently changing the guard's verdict —
/// these assertions fail. No production and no item is created (the guard rejects
/// before any Ens.Config write), so this suite touches no interoperability state. The one write is
/// <method>TestIsProductionClassUncompiledSuperPieces</method> (Story 38.7), which saves four
/// disposable class definitions named <code>ExecuteMCPv2.Temp.Story387Guard*</code>, never compiled,
/// and removes them before and after every test.</p>
Class ExecuteMCPv2.Tests.InteropHostGuardTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue) As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Replicate the CR 17.2-3 + CR 18.0-1 add-branch host guard decision, using the SAME IRIS
/// primitives in the SAME order as ExecuteMCPv2.REST.Interop:ItemManage. Returns a verdict
/// token: "reject:empty", "reject:notexist", "reject:nothost", "reject:abstract", or "accept".
Method ClassifyHost(pClassName As %String) As %String
{
    Set tClassName = $ZStrip(pClassName, "<>W")
    If tClassName = "" Quit "reject:empty"
    If '##class(%Dictionary.CompiledClass).%ExistsId(tClassName) Quit "reject:notexist"
    If '$classmethod(tClassName, "%Extends", "Ens.Host") Quit "reject:nothost"
    Set tCC = ##class(%Dictionary.CompiledClass).%OpenId(tClassName)
    If $IsObject(tCC) && tCC.Abstract Quit "reject:abstract"
    Quit "accept"
}

/// A concrete (non-abstract) Ens.Host business host is ACCEPTED — both a service and an
/// operation, so the guard is not accidentally service-only.
Method TestConcreteHostsAccepted() As %Status
{
    Do $$$AssertEquals(..ClassifyHost("EnsLib.File.PassthroughService"), "accept", "A concrete Ens.Host service passes the add guard")
    Do $$$AssertEquals(..ClassifyHost("EnsLib.File.PassthroughOperation"), "accept", "A concrete Ens.Host operation passes the add guard")
    Quit $$$OK
}

/// An ABSTRACT Ens.Host (extends Ens.Host but cannot be instantiated) is REJECTED at the
/// abstract check — the CR 18.0-1 remaining-half fix. Both a concrete-looking abstract base
/// (Ens.BusinessService) and Ens.Host itself must be rejected.
Method TestAbstractHostsRejected() As %Status
{
    Do $$$AssertEquals(..ClassifyHost("Ens.BusinessService"), "reject:abstract", "An abstract business-host base is rejected as a production item")
    Do $$$AssertEquals(..ClassifyHost("Ens.Host"), "reject:abstract", "Ens.Host itself (abstract) is rejected")
    Quit $$$OK
}

/// A compiled class that does NOT extend Ens.Host is REJECTED at the host check — the
/// CR 18.0-1 remaining-half fix guards against a non-host %Library.* class that would
/// otherwise pass the mere %ExistsId check and fail later at production start.
Method TestNonHostRejected() As %Status
{
    Do $$$AssertEquals(..ClassifyHost("%Stream.GlobalCharacter"), "reject:nothost", "A compiled non-Ens.Host class is rejected before the abstract check")
    Quit $$$OK
}

/// A className that is not compiled is REJECTED at the existence check (CR 17.2-3) — the
/// first gate, ahead of the host/abstract checks.
Method TestNonexistentClassRejected() As %Status
{
    Do $$$AssertEquals(..ClassifyHost("ExecuteMCPv2.Tests.NoSuchHostZZZ"), "reject:notexist", "A non-compiled className is rejected at the existence gate")
    Quit $$$OK
}

/// The whitespace half of CR 18.0-1: a className with stray surrounding whitespace is
/// stripped and then classifies as its clean form (so a valid host is not mis-rejected as
/// "does not exist"); an all-whitespace value collapses to empty and is rejected.
Method TestWhitespaceStrippedBeforeClassification() As %Status
{
    Do $$$AssertEquals(..ClassifyHost("  EnsLib.File.PassthroughService  "), "accept", "Surrounding whitespace is stripped before the existence check")
    Do $$$AssertEquals(..ClassifyHost("   "), "reject:empty", "An all-whitespace className collapses to empty and is rejected")
    Quit $$$OK
}

/// DW-54: the production-delete state guard is <method>ExecuteMCPv2.REST.Interop:DeleteBlockedByState</method>.
/// When the target IS the namespace's current production, only Stopped (state 2, or -2 for a mirror
/// backup member's Stopped) may be deleted; every other state is refused, including Unknown (0 and
/// out-of-range codes), Suspended, Troubled, NetworkStopped and ShardWorkerProhibited. A production
/// that is not the current one is never blocked: GetProductionStatus says nothing about it.
/// Also pins the state names and the refusal text (<method>DeleteBlockedMessage</method>).
Method TestDeleteBlockedByState() As %Status
{
    Set tTarget = "Some.Production"
    For tState = 0, 1, 3, 4, 5, 6 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedByState(tTarget, tTarget, tState), 1, "state " _ tState _ " of the current production blocks the delete")
    }
    For tState = 2, -2 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedByState(tTarget, tTarget, tState), 0, "Stopped (state " _ tState _ ") of the current production does not block the delete")
    }
    For tState = 0, 1, 2, 3, -2 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedByState(tTarget, "Other.Production", tState), 0, "state " _ tState _ " of a DIFFERENT current production never blocks the delete")
    }
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedByState(tTarget, "", 0), 0, "no current production (empty name) never blocks the delete")

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(1), "Running", "state 1 is Running")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(2), "Stopped", "state 2 is Stopped")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(3), "Suspended", "state 3 is Suspended")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(4), "Troubled", "state 4 is Troubled")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(5), "NetworkStopped", "state 5 is NetworkStopped")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(0), "Unknown", "state 0 is Unknown")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).StateName(6), "Unknown", "state 6 is Unknown")

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedMessage(tTarget, 1), "Production 'Some.Production' is running; stop it before deleting", "Running keeps its exact refusal text")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedMessage(tTarget, 3), "Production 'Some.Production' is in state Suspended; stop it before deleting", "Suspended names its state")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedMessage(tTarget, 4), "Production 'Some.Production' is in state Troubled; stop it before deleting", "Troubled names its state")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedMessage(tTarget, 5), "Production 'Some.Production' is in state NetworkStopped; stop it before deleting", "NetworkStopped names its state")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteBlockedMessage(tTarget, 0), "Production 'Some.Production' is in state Unknown; stop it before deleting", "Unknown names its state")
    Quit $$$OK
}

/// Story 38.7 (DW-531): the delete handler asks the state question through one seam,
/// <method>ExecuteMCPv2.REST.Interop:DeleteStateRefusal</method>. With injected values it gives the
/// exact Running text for state 1, the state text for the other blocking states, and "" for Stopped
/// (2 or -2), for a different current production, for no current production and for an error status.
Method TestDeleteStateRefusalSeamInjected() As %Status
{
    Set tTarget = "Some.Production"
    Set tStateName(0) = "Unknown", tStateName(3) = "Suspended", tStateName(4) = "Troubled", tStateName(5) = "NetworkStopped", tStateName(6) = "Unknown"

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$OK, tTarget, 1), "Production 'Some.Production' is running; stop it before deleting", "state 1 of the current production gives the exact Running text")
    For tState = 0, 3, 4, 5, 6 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$OK, tTarget, tState), "Production 'Some.Production' is in state " _ tStateName(tState) _ "; stop it before deleting", "state " _ tState _ " of the current production gives the state text")
    }
    For tState = 2, -2 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$OK, tTarget, tState), "", "Stopped (state " _ tState _ ") allows the delete")
    }
    For tState = 0, 1, 3 {
        Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$OK, "Other.Production", tState), "", "state " _ tState _ " of a DIFFERENT current production allows the delete")
    }
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$OK, "", 1), "", "no current production allows the delete")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal(tTarget, 1, $$$ERROR($$$GeneralError, "no status"), tTarget, 1), "", "an error status keeps the unguarded behavior")
    Quit $$$OK
}

/// Story 38.7 (DW-531): with nothing injected the seam reads the live state through
/// <code>Ens.Director:GetProductionStatus</code>. A target that is not this namespace's current
/// production is never blocked, whatever state the namespace is in, so the answer here is "". A refusal
/// through the route needs a running production, which this suite never starts.
Method TestDeleteStateRefusalSeamLive() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).DeleteStateRefusal("ExecuteMCPv2.Temp.Story387NotCurrent"), "", "an uninjected call for a production that is not the current one allows the delete")

    ; Which state a live call would block cannot be shown without a running production, so the order of the
    ; live read is pinned from the seam's own definition: the current name comes first, then the state.
    Set tSeamText = ..MethodSource("DeleteStateRefusal")
    Do $$$AssertTrue(tSeamText '= "", "the DeleteStateRefusal implementation is readable")
    Do $$$AssertEquals(..CountOccurrences(tSeamText, "GetProductionStatus(.tCurrentName, .tState)"), 1, "the uninjected seam reads the current production's name and then its state")
    Do $$$AssertEquals(..CountOccurrences(tSeamText, "DeleteBlockedByState(pTarget, tCurrentName, tState)"), 1, "the seam applies the state rule to the target, the current name and the state, in that order")
    Quit $$$OK
}

/// Story 38.7 (DW-533): a compiled class is a production when it extends Ens.Production, and a
/// nonexistent class is not one. (The classes named here ship with IRIS.)
Method TestIsProductionClassCompiled() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass("Ens.Enterprise.Production"), 1, "a compiled class that extends Ens.Production is a production class")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass("EnsLib.File.PassthroughService"), 0, "a compiled business service is not a production class")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass("%Stream.GlobalCharacter"), 0, "a compiled non-Ens class is not a production class")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass("ExecuteMCPv2.Tests.NoSuchProductionZZZ"), 0, "a class that does not exist is not a production class")
    Quit $$$OK
}

/// Story 38.7 (DW-533): a class that is defined but not compiled is a production when
/// <code>Ens.Production</code> is an exact comma-separated piece of its Super: a longer name that merely
/// starts with it, or a different superclass, is not.
Method TestIsProductionClassUncompiledSuperPieces() As %Status
{
    Set tPrefix = "ExecuteMCPv2.Temp.Story387Guard"
    Do $$$AssertStatusOK(..DefineClass(tPrefix _ "Direct", "Ens.Production"), "the direct production definition is saved")
    Do $$$AssertStatusOK(..DefineClass(tPrefix _ "Listed", "%RegisteredObject,Ens.Production"), "the listed production definition is saved")
    Do $$$AssertStatusOK(..DefineClass(tPrefix _ "Longer", "Ens.ProductionOther"), "the longer-name definition is saved")
    Do $$$AssertStatusOK(..DefineClass(tPrefix _ "Plain", "%RegisteredObject"), "the plain definition is saved")
    Do $$$AssertTrue('##class(%Dictionary.CompiledClass).%ExistsId(tPrefix _ "Direct"), "precondition: the definitions are not compiled")

    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass(tPrefix _ "Direct"), 1, "Ens.Production as the whole Super")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass(tPrefix _ "Listed"), 1, "Ens.Production as one comma piece of the Super")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass(tPrefix _ "Longer"), 0, "a longer name that starts with Ens.Production is not a piece")
    Do $$$AssertEquals(##class(ExecuteMCPv2.REST.Interop).IsProductionClass(tPrefix _ "Plain"), 0, "a different superclass is not a production")
    Quit $$$OK
}

/// Story 38.7 (DW-531, DW-533): the wiring of <method>ExecuteMCPv2.REST.Interop:ProductionManage</method>,
/// read from its method definition. A refusal through the route for a running production needs a running
/// production, so this pins the order of the code instead: the handler asks the state question only through
/// the seam, exactly once, before BOTH deletes, and checks the class kind before the class delete.
Method TestProductionManageWiring() As %Status
{
    Set tText = ..ProductionManageSource()
    Do $$$AssertTrue(tText '= "", "the ProductionManage implementation is readable")

    Set tSeamToken = "..DeleteStateRefusal(tName)"
    Set tSeam = $Find(tText, tSeamToken)
    Do $$$AssertEquals(..CountOccurrences(tText, tSeamToken), 1, "the handler calls the seam exactly once")
    Do $$$AssertEquals(..CountOccurrences(tText, "GetProductionStatus("), 0, "the handler never reads the production status itself")
    Do $$$AssertEquals(..CountOccurrences(tText, "%DeleteId("), 2, "the handler has the two deletes (the class and the orphan row)")

    Set tClassDelete = $Find(tText, "ClassDefinition).%DeleteId(")
    Set tRowDelete = $Find(tText, "Ens.Config.Production).%DeleteId(")
    Do $$$AssertTrue((tSeam > 0) && (tClassDelete > tSeam), "the seam call comes before the class delete")
    Do $$$AssertTrue((tSeam > 0) && (tRowDelete > tSeam), "the seam call comes before the orphan-row delete")

    Set tGateToken = "If tStateRefusal '= " _ $Char(34, 34)
    Set tGate = $Find(tText, tGateToken)
    Do $$$AssertEquals(..CountOccurrences(tText, tGateToken), 1, "the seam's answer decides the refusal, exactly once")
    Do $$$AssertTrue((tSeam > 0) && (tGate > tSeam) && (tClassDelete > tGate) && (tRowDelete > tGate), "the refusal is decided right after the seam call, before both deletes")

    Set tKindToken = "..IsProductionClass(tName)"
    Set tKind = $Find(tText, tKindToken)
    Do $$$AssertEquals(..CountOccurrences(tText, tKindToken), 1, "the handler checks the class kind exactly once")
    Do $$$AssertTrue((tKind > 0) && (tKind > tSeam) && (tClassDelete > tKind), "the class-kind check comes after the seam and before the class delete")
    Quit $$$OK
}

/// The implementation text of <method>ExecuteMCPv2.REST.Interop:ProductionManage</method>, or "" when its
/// method definition cannot be opened.
Method ProductionManageSource() As %String
{
    Quit ..MethodSource("ProductionManage")
}

/// The implementation text of the method <var>pMethod</var> of <class>ExecuteMCPv2.REST.Interop</class>, or ""
/// when its method definition cannot be opened.
Method MethodSource(pMethod As %String) As %String
{
    Set tText = ""
    Set tMethod = ##class(%Dictionary.MethodDefinition).%OpenId("ExecuteMCPv2.REST.Interop||" _ pMethod)
    If '$IsObject(tMethod) Quit ""
    Do tMethod.Implementation.Rewind()
    While 'tMethod.Implementation.AtEnd {
        Set tText = tText _ tMethod.Implementation.Read(30000)
    }
    Quit tText
}

/// How many times <var>pToken</var> occurs in <var>pText</var>.
Method CountOccurrences(pText As %String, pToken As %String) As %Integer
{
    Set tCount = 0
    Set tPosition = 1
    For {
        Set tFound = $Find(pText, pToken, tPosition)
        Quit:tFound=0
        Set tCount = tCount + 1
        Set tPosition = tFound
    }
    Quit tCount
}

/// Define the class <var>pName</var> with the superclass list <var>pSuper</var>, saved but not compiled.
Method DefineClass(pName As %String, pSuper As %String) As %Status
{
    Set tDefinition = ##class(%Dictionary.ClassDefinition).%New()
    Set tDefinition.Name = pName
    Set tDefinition.Super = pSuper
    Quit tDefinition.%Save()
}

/// Remove the disposable definitions the uncompiled-Super test saves.
Method RemoveFixtures()
{
    Kill tNames
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?", "ExecuteMCPv2.Temp.Story387Guard")
    If $IsObject(tRS) && (tRS.%SQLCODE >= 0) {
        While tRS.%Next() { Set tNames(tRS.%GetData(1)) = "" }
    }
    Set tName = ""
    For {
        Set tName = $Order(tNames(tName))
        Quit:tName=""
        Do ##class(%Dictionary.ClassDefinition).%DeleteId(tName)
    }
}

Method OnBeforeOneTest() As %Status
{
    Do ..RemoveFixtures()
    Quit $$$OK
}

Method OnAfterOneTest(testname As %String) As %Status
{
    Do ..RemoveFixtures()
    Quit $$$OK
}

}
