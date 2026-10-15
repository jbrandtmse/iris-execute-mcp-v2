/// Live resend tests for <class>ExecuteMCPv2.REST.MessageResend</class> (Story 26.1, AC 26.1.1),
/// split out of <class>ExecuteMCPv2.Tests.MessageResendTest</class> (Section D) so the pure,
/// REST-guard and fixture-row tests there run on any instance.
/// <p>Both tests drive a REAL resend + new-header linkage against the scratch production
/// <code>SessionAgent.Sample.Production</code> (started only if not already running, stopped
/// again afterward; scratch header rows deleted) through <method>ResendOne</method>,
/// <method>PreviewOne</method> and <method>ResendBatch</method> directly - pure classmethods with no
/// <code>%request</code> dependency, the identical code path the guarded entry points call -
/// against the pinned <code>Ens.MessageHeader:ResendDuplicatedMessage</code> API (Story 26.0).</p>
/// <p>The scratch production and its <code>SessionAgent.Sample.BS.OrderIngest</code> scenario
/// service are not part of this project: an instance without them is a legitimate environment, not a
/// failure. Each test therefore begins with <method>FixtureSkipReason</method>; when either class is
/// not compiled it logs a <code>SKIP:</code> line and returns without asserting anything.</p>
Class ExecuteMCPv2.Tests.MessageResendLiveTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Why the live fixtures are unavailable in the current namespace: the first of
/// <code>SessionAgent.Sample.Production</code> / <code>SessionAgent.Sample.BS.OrderIngest</code> that
/// is not a compiled class, named in a sentence. Empty when both are compiled.
Method FixtureSkipReason() As %String
{
    If '##class(%Dictionary.CompiledClass).%ExistsId("SessionAgent.Sample.Production") {
        Quit "SessionAgent.Sample.Production is not a compiled class in namespace " _ $NAMESPACE
    }
    If '##class(%Dictionary.CompiledClass).%ExistsId("SessionAgent.Sample.BS.OrderIngest") {
        Quit "SessionAgent.Sample.BS.OrderIngest is not a compiled class in namespace " _ $NAMESPACE
    }
    Quit ""
}

/// A REAL single resend + new-header linkage, driven against
/// SessionAgent.Sample.Production (started only if not already running; scratch
/// header rows deleted and the production stopped again afterward). Exercises
/// ResendOne/PreviewOne directly - the exact code path the guarded HTTP entry points
/// call - against the pinned Ens.MessageHeader:ResendDuplicatedMessage API.
Method TestRealResendAgainstScratchProduction() As %Status
{
    Set tSkip = ..FixtureSkipReason()
    If tSkip '= "" {
        Do $$$LogMessage("SKIP: " _ tSkip)
        Quit $$$OK
    }

    Set tWasRunning = ##class(Ens.Director).IsProductionRunning()
    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StartProduction("SessionAgent.Sample.Production")
        Do $$$AssertStatusOK(tSC, "Scratch production starts")
    }

    Set tMaxBefore = 0
    Try {
        Set tRS0 = ##class(%SQL.Statement).%ExecDirect(, "SELECT MAX(ID) AS mx FROM Ens.MessageHeader")
        If $IsObject(tRS0) && tRS0.%Next() { Set tMaxBefore = +tRS0.mx }

        Do ##class(SessionAgent.Sample.BS.OrderIngest).RunScenario("none")
        Hang 2

        Set tOriginalId = 0
        Set tRS1 = ##class(%SQL.Statement).%ExecDirect(, "SELECT TOP 1 ID FROM Ens.MessageHeader WHERE ID > ? AND Type = 1 ORDER BY ID", tMaxBefore)
        If $IsObject(tRS1) && tRS1.%Next() { Set tOriginalId = +tRS1.ID }
        Do $$$AssertTrue(tOriginalId > 0, "A new Request header was created by the scenario run")

        If tOriginalId > 0 {
            Set tRow = ##class(ExecuteMCPv2.REST.MessageResend).ResendOne(tOriginalId, 0)
            Do $$$AssertEquals(tRow.%Get("ok"), 1, "Real resend reports ok")
            Do $$$AssertEquals(tRow.%Get("originalId"), tOriginalId, "originalId echoed")
            Do $$$AssertTrue(tRow.%IsDefined("newHeaderId"), "newHeaderId present on success")
            Set tNewId = tRow.%Get("newHeaderId")
            Do $$$AssertTrue(tNewId '= tOriginalId, "New header id differs from the original")

            If tRow.%Get("ok") {
                Set tRS2 = ##class(%SQL.Statement).%ExecDirect(, "SELECT Description, SessionId FROM Ens.MessageHeader WHERE ID = ?", tNewId)
                Do $$$AssertTrue($IsObject(tRS2) && tRS2.%Next(), "New header row exists")
                If $IsObject(tRS2) {
                    Do $$$AssertTrue(tRS2.Description [ ("Resent " _ tOriginalId), "New header Description carries the resend linkage")
                }

                Set tPreview = ##class(ExecuteMCPv2.REST.MessageResend).PreviewOne(tOriginalId)
                Do $$$AssertEquals(tPreview.%Get("found"), 1, "Original header previews as found")
                Do $$$AssertEquals(tPreview.%Get("type"), "Request", "Original header previews as Request type")
                Do $$$AssertTrue(tPreview.%IsDefined("verdict"), "Preview carries a verdict")
                Do $$$AssertTrue(tPreview.%IsDefined("reason"), "Preview carries a reason")
            }
        }

        Hang 1
        Set tDelRS = ##class(%SQL.Statement).%ExecDirect(, "DELETE FROM Ens.MessageHeader WHERE ID > ?", tMaxBefore)
        Do $$$AssertTrue($IsObject(tDelRS) && (tDelRS.%SQLCODE >= 0), "Scratch header cleanup sweep succeeded")
    } Catch ex {
        Do $$$AssertTrue(0, "Unexpected exception during real-resend test: " _ ex.DisplayString())
    }

    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StopProduction(60, 1)
        Do $$$AssertStatusOK(tSC, "Scratch production stopped back to its pre-test state")
    }
    Quit $$$OK
}

/// A <method>ResendBatch</method> call with a mix of one VALID header (resends
/// successfully against the scratch production) and one bad/nonexistent header ID
/// must return a per-header {ok} result for EACH entry and must NOT abort the batch
/// (spec section 3 / AC 26.1.1 per-message Try/Catch continuation). Exercises the exact
/// classmethod the guarded <method>MessageResend</method> HTTP entry point calls.
Method TestResendBatchContinuesPastBadHeader() As %Status
{
    Set tSkip = ..FixtureSkipReason()
    If tSkip '= "" {
        Do $$$LogMessage("SKIP: " _ tSkip)
        Quit $$$OK
    }

    Set tWasRunning = ##class(Ens.Director).IsProductionRunning()
    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StartProduction("SessionAgent.Sample.Production")
        Do $$$AssertStatusOK(tSC, "Scratch production starts")
    }

    Set tMaxBefore = 0
    Try {
        Set tRS0 = ##class(%SQL.Statement).%ExecDirect(, "SELECT MAX(ID) AS mx FROM Ens.MessageHeader")
        If $IsObject(tRS0) && tRS0.%Next() { Set tMaxBefore = +tRS0.mx }

        Do ##class(SessionAgent.Sample.BS.OrderIngest).RunScenario("none")
        Hang 2

        Set tValidId = 0
        Set tRS1 = ##class(%SQL.Statement).%ExecDirect(, "SELECT TOP 1 ID FROM Ens.MessageHeader WHERE ID > ? AND Type = 1 ORDER BY ID", tMaxBefore)
        If $IsObject(tRS1) && tRS1.%Next() { Set tValidId = +tRS1.ID }
        Do $$$AssertTrue(tValidId > 0, "A new Request header was created for the batch-continuation test")

        If tValidId > 0 {
            Set tBadId = 999999999
            Set tIds(0) = 2
            Set tIds(1) = tValidId
            Set tIds(2) = tBadId
            Set tResult = {}
            Do ##class(ExecuteMCPv2.REST.MessageResend).ResendBatch(.tIds, 0, tResult)

            Set tResults = tResult.%Get("results")
            Do $$$AssertEquals(tResults.%Size(), 2, "Batch returns one result entry per header, even after a bad one")

            Set tRow1 = tResults.%Get(0)
            Do $$$AssertEquals(tRow1.%Get("originalId"), tValidId, "First result echoes the valid header id")
            Do $$$AssertEquals(tRow1.%Get("ok"), 1, "Valid header resends ok")
            Do $$$AssertTrue(tRow1.%IsDefined("newHeaderId"), "Valid header result carries a newHeaderId")

            Set tRow2 = tResults.%Get(1)
            Do $$$AssertEquals(tRow2.%Get("originalId"), tBadId, "Second result echoes the bad header id - batch did not abort after the first entry")
            Do $$$AssertEquals(tRow2.%Get("ok"), 0, "Nonexistent header fails")
            Do $$$AssertTrue(tRow2.%Get("error") '= "", "Failure carries a non-empty error message")

            Set tSummary = tResult.%Get("summary")
            Do $$$AssertEquals(tSummary.%Get("total"), 2, "Summary total counts both headers")
            Do $$$AssertEquals(tSummary.%Get("succeeded"), 1, "Summary succeeded=1")
            Do $$$AssertEquals(tSummary.%Get("failed"), 1, "Summary failed=1")
        }

        Hang 1
        Set tDelRS = ##class(%SQL.Statement).%ExecDirect(, "DELETE FROM Ens.MessageHeader WHERE ID > ?", tMaxBefore)
        Do $$$AssertTrue($IsObject(tDelRS) && (tDelRS.%SQLCODE >= 0), "Scratch header cleanup sweep succeeded")
    } Catch ex {
        Do $$$AssertTrue(0, "Unexpected exception during batch-continuation test: " _ ex.DisplayString())
    }

    If 'tWasRunning {
        Set tSC = ##class(Ens.Director).StopProduction(60, 1)
        Do $$$AssertStatusOK(tSC, "Scratch production stopped back to its pre-test state")
    }
    Quit $$$OK
}

}
