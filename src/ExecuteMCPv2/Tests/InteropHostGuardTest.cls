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
/// these assertions fail. Read-only: no production, no item is created (the guard rejects
/// before any Ens.Config write), so this suite touches no interoperability state.</p>
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

}
