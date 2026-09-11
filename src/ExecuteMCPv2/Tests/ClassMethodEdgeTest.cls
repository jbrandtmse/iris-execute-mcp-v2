/// Story 36.3 (Rule #37 ledger burn-down) regression pins for Epic-34 Cluster
/// B/E residuals that `ExecuteMCPv2.Tests.ClassMethodArgsTest` (already near the
/// project's ~500-line guideline at 987 lines) should not grow further to cover —
/// kept in its OWN class per the same rationale `ClassMethodBudgetTest` already
/// established.
/// <p>Covers: `34-1-R5` (ZN-then-throw, ZN-to-nonexistent-namespace), `34-1-R8`
/// (arity over/under-supply), `34-1-R10` (output/error-text contract), `34-1-R11`
/// (redirect teardown asserts <c>$IO</c> against <c>tInitIO</c>, including the
/// hard-error path), `34-1-R16` (multi-ZN interleaved narration), and — added at the
/// Story 36.3 code review — `34-2-R6`/`34-4-R7` (a THROWING <code>Use</code> step still
/// closes the capture device) and `34-4-R5`/`34-3-R6` (a stale capture flag is never
/// observed by a later call).</p>
/// <p>The capture-path tests below drive <method>ExecuteMCPv2.Utils.InvokeWithArgs</method>
/// (the dispatch chain <method>ExecuteMCPv2.REST.Command.ClassMethod</method> calls) with a
/// hand-built redirect bound to the production mnemonic routine — NOT the REST handler
/// itself, which needs a live <code>%request</code>; the handler's own teardown is pinned
/// through <method>ExecuteMCPv2.REST.Command.TeardownRedirect</method> directly, and the
/// full endpoint through the TS live gate (<c>execute-classmethod-epic-gate.test.ts</c>).</p>
Class ExecuteMCPv2.Tests.ClassMethodEdgeTest Extends %UnitTest.TestCase
{

Parameter FIXTURE = "ExecuteMCPv2.Tests.ClassMethodArgsFixture";

Method OnBeforeOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Quit $$$OK
}

Method OnAfterOneTest() As %Status
{
    Kill %ExecuteMCPOutput
    Kill %ExecuteMCPTruncated
    Try {
        Do ##class(%Library.Device).ReDirectIO(0)
    } Catch {}
    Quit $$$OK
}

/// `34-1-R8` — over-supplying a call (3 args) against a target declaring exactly 2
/// formals must surface as a real, sanitizable error naming `<PARAMETER>` — live-
/// verified (2026-09-11) against a real user-class target before this test was
/// written (Rule #16): `$ClassMethod` with 3 dot-passed args against a 2-formal
/// method raises `ERROR #5002: ObjectScript error: <PARAMETER>...`.
Method TestArityOverSupplyRejectedWithParameterError() As %Status
{
    Set tArgs = ["a", "b", "c"]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetTwoFormals", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "over-supplying a 2-formal target with 3 args must be rejected, not silently accepted")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "PARAMETER", "the real <PARAMETER> arity-mismatch text must be surfaced (Rule #9), not a generic message: ["_tText_"]")
    Do $$$AssertEquals(tTruncated, 0, "an arity rejection is not a capture truncation")
    Quit $$$OK
}

/// `34-1-R8` — under-supplying a call (1 arg) against a target declaring 2 formals
/// must succeed cleanly, the unsupplied trailing formal left genuinely undefined on
/// the target side — the same "safe by construction" contract `Target20`'s own
/// `$Data` guards rely on, pinned here against an UNGUARDED target so the contract
/// does not depend on every real-world target defensively guarding its own formals.
Method TestArityUnderSupplyLeavesTrailingFormalUndefined() As %Status
{
    Set tArgs = ["only-one"]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetTwoFormals", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "under-supplying an unguarded target must not error — the trailing formal is simply unbound")
    Do $$$AssertEquals(tReturn, "two:only-one,", "the second, unsupplied formal must read back as an empty/undefined value, not throw or fabricate a value")
    Quit $$$OK
}

/// `34-1-R5` — a target that ZNs to a real, existing namespace and THEN throws.
/// `InvokeWithArgs` itself must surface the real error and must NOT attempt any
/// namespace restoration of its own (that is `ExecuteMCPv2.REST.Command`'s job,
/// exercised end-to-end over live HTTP by a companion probe in this story) — pinning
/// that division of responsibility here: immediately after this call, `$NAMESPACE`
/// is still whatever the target's own `ZN` left it as.
Method TestZNThenThrowSurfacesErrorAndLeavesNamespaceForCallerToRestore() As %Status
{
    Set tOrigNS = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetZNThenThrow", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "a target that ZNs then throws must surface as a real error")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue((tText [ "DIVIDE") || (tText [ "<DIVIDE>"), "the real divide-by-zero text must be propagated (Rule #9): ["_tText_"]")
    Do $$$AssertEquals($NAMESPACE, "USER", "InvokeWithArgs does not restore namespace itself — the target's ZN is still in effect immediately after it returns; ExecuteMCPv2.REST.Command restores it before rendering (verified separately, live)")
    Set $NAMESPACE = tOrigNS
    Quit $$$OK
}

/// `34-1-R5` — a target that ZNs to a namespace that does not exist. The `<NAMESPACE>`
/// error is raised BY THE ZN COMMAND ITSELF, before the target's own body ever runs,
/// while the endpoint's I/O redirect is still bound — pinning that this reaches the
/// caller as an ordinary sanitizable error (never a crash out of `InvokeWithArgs`) and
/// that the process is left in the LAST namespace it was actually in (the ZN never
/// took effect) rather than some undefined state.
Method TestZNToNonexistentNamespaceSurfacesNamespaceError() As %Status
{
    Set tOrigNS = $NAMESPACE
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetZNToNonexistentNamespace", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusNotOK(tSC, "ZN to a nonexistent namespace must surface as a real error")
    Set tText = $System.Status.GetErrorText(tSC)
    Do $$$AssertTrue(tText [ "NAMESPACE", "the real <NAMESPACE> text must be propagated (Rule #9): ["_tText_"]")
    Do $$$AssertEquals($NAMESPACE, tOrigNS, "a ZN that itself throws must never have taken effect — the process stays in its prior namespace")
    Quit $$$OK
}

/// `34-1-R16` — several ZN switches interleaved with Write narration AND a ByRef
/// mutation between each switch (bug report repro 3's actual shape — the existing
/// `TargetZNWriteByRef`/gate leg simplifies repro 3 to a single switch). Exercised
/// through the real dispatch chain (mnemonic bound in this test's own frame, one
/// extra routine hop via `InvokeWithArgs`, matching production).
Method TestMultiZNInterleavedNarrationAndByRefThroughDispatch() As %Status
{
    Set tOrigNS = $NAMESPACE
    Set %ExecuteMCPOutput = ""
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tArgs = [{"byRef":true,"value":"start"}]
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetMultiZNInterleaved", tArgs, .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Set tNSAfterCall = $NAMESPACE
    Set $NAMESPACE = tOrigNS

    Do $$$AssertStatusOK(tSC, "a multi-ZN-interleaved call through the dispatch chain should succeed")
    Do $$$AssertEquals(%ExecuteMCPOutput, "start:"_tOrigNS_$Char(10)_"mid1:USER"_$Char(10)_"mid2:%SYS"_$Char(10)_"end:USER", "narration across every switch must be captured completely and in order")
    Do $$$AssertEquals(tNSAfterCall, "USER", "the target's LAST ZN should persist past return, exactly as production sees before Command.cls's own restore")
    Do $$$AssertEquals(tByRefValues.%Get("0"), "start-mid1-mid2-end", "the ByRef mutation between each switch must all be read back, in order")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// `34-1-R10` — the output/error-text contract Story 34.1's own probe left unpinned:
/// dev and QA captured different bytes for "the same" test (a trailing newline
/// present in one, absent in the other). Pins, through the real dispatch chain and the
/// production capture mnemonic (see the class banner for what this does NOT cover),
/// that a target's `Write` output up to a mid-execution throw is captured BYTE-EXACT,
/// including a trailing newline the target itself wrote — neither stripped nor
/// duplicated — and that the thrown error's sanitized text is well-formed (Rule #9).
Method TestOutputContractPreservesTrailingNewlineOnThrownTarget() As %Status
{
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Set %ExecuteMCPOutput = ""
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "TargetWriteNewlineThenThrow", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)

    Do ##class(%Library.Device).ReDirectIO(0)
    Use tInitIO
    Close tNull

    Do $$$AssertStatusNotOK(tSC, "a target that writes then throws must surface as a real error")
    Set tSanitized = ##class(ExecuteMCPv2.Utils).SanitizeError(tSC)
    Set tText = $System.Status.GetErrorText(tSanitized)
    Do $$$AssertTrue((tText [ "DIVIDE") || (tText [ "<DIVIDE>"), "the real error text must survive SanitizeError (Rule #9): ["_tText_"]")
    ; Rule #8: SanitizeError strips exactly ONE leading "ERROR #N: " prefix before
    ; re-wrapping in $$$ERROR — $System.Status.GetErrorText on the RE-WRAPPED status
    ; legitimately renders its OWN single "ERROR #5001: " prefix (the $$$GeneralError
    ; code), so the correct pin is "never TWO such prefixes back to back", not "zero
    ; occurrences of the substring anywhere".
    Do $$$AssertTrue(tText '[ "ERROR #5001: ERROR #", "SanitizeError must strip exactly one leading prefix, never double-wrap (Rule #8): ["_tText_"]")
    Set tPrefixCount = 0
    Set tScanFrom = 1
    For {
        Set tHit = $Find(tText, "ERROR #", tScanFrom)
        Quit:tHit=0
        Set tPrefixCount = tPrefixCount + 1
        Set tScanFrom = tHit
    }
    Do $$$AssertEquals(tPrefixCount, 1, "exactly one 'ERROR #' prefix must appear in the final sanitized text, never a double-wrap: ["_tText_"]")
    Do $$$AssertEquals(%ExecuteMCPOutput, "before-throw"_$Char(10), "the captured output up to the throw must be byte-exact, INCLUDING the target's own trailing newline — neither stripped nor duplicated")
    Kill %ExecuteMCPOutput
    Quit $$$OK
}

/// `34-1-R11` — redirect teardown was previously proven only by INFERENCE (the
/// response looked right); `$IO` itself was never compared to `tInitIO`. Pins the
/// ORDINARY case directly against `TeardownRedirect` (34-2-R6/34-4-R7).
Method TestTeardownRedirectRestoresIOToInitIO() As %Status
{
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)
    Write "probe"

    Set tRestored = ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tInitIO, tNull)
    Do $$$AssertTrue(tRestored, "TeardownRedirect must report success on the ordinary path")
    Do $$$AssertEquals($IO, tInitIO, "34-1-R11: $IO must be compared to (and confirmed equal to) tInitIO, not merely assumed restored")
    Quit $$$OK
}

/// `34-1-R11` tolerance pin: `TeardownRedirect` must still report success and leave
/// `$IO` on `tInitIO` when the capture device was ALREADY closed out of band. (Story
/// 36.3 code review: this does NOT exercise step independence — closing a device that
/// is not open is not an error, and closing the current device already reverts `$IO`
/// to the principal — so the pre-fix inline teardown would pass it too. The genuine
/// hard-error path, a THROWING `Use` step, is pinned by
/// <method>TestTeardownRedirectClosesCaptureDeviceEvenWhenUseThrows</method>.)
Method TestTeardownRedirectRestoresIOEvenWhenCloseAlreadyHappened() As %Status
{
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Use tNull::("^ExecuteMCPv2.REST.Command.1")
    Do ##class(%Library.Device).ReDirectIO(1)
    Write "probe"
    ; Simulate the Close step having already failed/happened: disable the redirect
    ; and close the device OUT OF BAND, before TeardownRedirect ever runs, so its OWN
    ; Close attempt is a guaranteed no-op/failure.
    Do ##class(%Library.Device).ReDirectIO(0)
    Close tNull

    Set tRestored = ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tInitIO, tNull)
    Do $$$AssertTrue(tRestored, "TeardownRedirect must still report success — ReDirectIO(0) and Use are independent of the already-done Close (34-2-R6)")
    Do $$$AssertEquals($IO, tInitIO, "$IO must still end up restored to tInitIO despite the out-of-band Close")
    Quit $$$OK
}

/// `34-1-R11` hard-error-path pin, the genuinely unrestorable case: TeardownRedirect
/// must HONESTLY report failure (never a false success) when `pInitIO` cannot
/// actually be `Use`-d, exercising the corrective-retry branch without masking the
/// real outcome. This method restores the TEST PROCESS's own real I/O afterward
/// (deliberately not via TeardownRedirect, already proven to fail here) so later
/// tests in this suite are unaffected.
Method TestTeardownRedirectReturnsFalseWhenDeviceTrulyUnrestorable() As %Status
{
    Set tRealInitIO = $IO
    Set tBogusInitIO = "ExecuteMCPv2TrulyBogusDevice9999"
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Open tNull:::1
    Do ##class(%Library.Device).ReDirectIO(1)

    Set tRestored = ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tBogusInitIO, tNull)
    Do $$$AssertTrue('tRestored, "TeardownRedirect must honestly report failure, not a false success, when the target device cannot really be restored")

    Try { Do ##class(%Library.Device).ReDirectIO(0) } Catch {}
    Try { Use tRealInitIO } Catch {}
    Quit $$$OK
}

/// `34-2-R6` / `34-4-R7` — the genuine hard-error path (Story 36.3 code review): the
/// `Use` step THROWS while `$IO` is the capture device. Before the fix the three
/// teardown steps were one unguarded sequence, so a throwing `Use` skipped `Close` and
/// left `$IO` on the capture device, where the following render landed (HTTP 200, empty
/// body). Pins that `Close` still runs — the capture device is really closed — and that
/// `$IO` is no longer the capture device. A temporary FILE stands in for the null device:
/// inside the `%UnitTest` worker process `$PRINCIPAL` is itself the null device (live
/// probe, 2026-09-11), which would make "is the null device still open?" ambiguous here.
/// Mutation-verified live: merging the `Use` and `Close` steps into one `Try` drives the
/// last two assertions RED.
Method TestTeardownRedirectClosesCaptureDeviceEvenWhenUseThrows() As %Status
{
    Set tRealInitIO = $IO
    Set tBogusInitIO = "ExecuteMCPv2TrulyBogusDevice9999"
    Set tCap = ##class(%File).TempFilename("txt")
    Open tCap:("WNS"):2
    Set tOpened = $Test
    If tOpened {
        Use tCap::("^ExecuteMCPv2.REST.Command.1")
        Do ##class(%Library.Device).ReDirectIO(1)
        Write "probe"
    }

    Set tRestored = ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tBogusInitIO, tCap)
    Set tIOAfter = $IO
    ; Is the capture device still open? Use-ing a device this process has not opened
    ; raises <NOTOPEN>.
    Set tStillOpen = 0
    Try {
        Use tCap
        Set tStillOpen = 1
    } Catch {}

    ; Restore this test process's own I/O before asserting (never via TeardownRedirect).
    Try { Do ##class(%Library.Device).ReDirectIO(0) } Catch {}
    Try { Use tRealInitIO } Catch {}
    Try { Close tCap } Catch {}
    Do ##class(%File).Delete(tCap)

    Do $$$AssertTrue(tOpened, "the stand-in capture device must open (a timed Open sets $Test)")
    Do $$$AssertTrue('tRestored, "TeardownRedirect must honestly report failure when pInitIO cannot be Use-d")
    Do $$$AssertNotEquals(tIOAfter, tCap, "34-4-R7: $IO must no longer be the capture device after teardown, even though the Use step threw")
    Do $$$AssertTrue('tStillOpen, "34-2-R6: the Close step must still run when the Use step throws")
    Quit $$$OK
}

/// `34-4-R5` / `34-3-R6` (Story 36.3 code review, closing `36-3-QA-2`): a capture flag
/// left behind in a reused CSP worker must never surface as `truncated:true` on a later,
/// unrelated call. The stale value is seeded INSIDE this method — after
/// <method>OnBeforeOneTest</method> has already scrubbed both slots — so the harness's own
/// scrub cannot hide the defect class (the blind spot `36-3-QA-2` named). The guard is
/// <method>ExecuteMCPv2.Utils.InvokeWithArgs</method>' entry <code>Kill
/// %ExecuteMCPTruncated</code>, the reset every <code>/classmethod</code> call runs before
/// any capture can set the flag (<method>ExecuteMCPv2.REST.Command.Execute</method> resets
/// both slots with two unconditional <code>Set</code>s just before its own capture).
/// Mutation-verified live: removing that one <code>Kill</code> drives this test RED.
Method TestStaleTruncatedFlagFromAnEarlierRequestIsNeverObserved() As %Status
{
    Set %ExecuteMCPTruncated = 1
    Set tSC = ##class(ExecuteMCPv2.Utils).InvokeWithArgs(..#FIXTURE, "Target0", "", .tReturn, .tByRefValues, .tArgCount, .tTruncated)
    Do $$$AssertStatusOK(tSC, "a plain zero-argument call must succeed")
    Do $$$AssertEquals(tReturn, "zero-ok", "the target must actually have run")
    Do $$$AssertEquals(tTruncated, 0, "a stale %ExecuteMCPTruncated=1 left by an earlier request must never be reported as truncated on a later call (34-4-R5)")
    Quit $$$OK
}

}
