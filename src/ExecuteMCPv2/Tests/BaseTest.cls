/// Unit tests for <class>ExecuteMCPv2.REST.Base</class>.
/// <p>Covers the <method>RenderResponseBody</method> pre-flight override (Story 34.4,
/// AC 34.4.1/34.4.4) and pins the 15-handler re-parenting + the explicit
/// <class>ExecuteMCPv2.REST.Dispatch</class> non-re-parent decision.</p>
/// <p>Captures device output using the same label-based mnemonic pattern as
/// <class>ExecuteMCPv2.Tests.CommandTest</class>, bound to THIS class's own compiled
/// routine (Story 34.1 Constraint C-2: the mnemonic entry points must live in the
/// currently executing routine for <code>"^"_$ZNAME</code> to resolve them).</p>
Class ExecuteMCPv2.Tests.BaseTest Extends %UnitTest.TestCase
{

/// Clean up the capture buffer before each test.
Method OnBeforeOneTest() As %Status
{
    Kill %BaseTestCap
    Quit $$$OK
}

/// Clean up the capture buffer after each test.
Method OnAfterOneTest() As %Status
{
    Kill %BaseTestCap
    Quit $$$OK
}

/// Redirect $IO to the null device and bind the capture mnemonic on THIS routine.
Method StartCapture() As %String
{
    Set tInitIO = $IO
    Set tNull = ##class(%Library.Device).GetNullDevice()
    Set %BaseTestCap = ""
    Open tNull:::1
    Use tNull::("^"_$ZNAME)
    Do ##class(%Library.Device).ReDirectIO(1)
    Quit tInitIO
}

/// Restore $IO and return the captured text.
Method StopCapture(pInitIO As %String) As %String
{
    Set tNull = $IO
    Do ##class(%Library.Device).ReDirectIO(0)
    Use pInitIO
    Close tNull
    Set tCap = $Get(%BaseTestCap, "")
    Kill %BaseTestCap
    Quit tCap
}

/// AC 34.4.4: the success path is byte-identical between the raw
/// <class>%Atelier.REST</class> implementation and the <class>ExecuteMCPv2.REST.Base</class>
/// override, for a representative populated payload. <class>%Atelier.REST</class> is
/// not abstract, so its inherited classmethod is directly callable for this comparison.
Method TestSuccessPathByteIdenticalToParent() As %Status
{
    Set tResult = {}
    Do tResult.%Set("output", "hello")
    Do tResult.%Set("truncated", 0, "boolean")

    ; Teardown guard: without it, a throw inside the method under test (exactly the
    ; regression class this suite pins) skips StopCapture, leaving ReDirectIO(1)
    ; active for every SUBSEQUENT test in the 329-method package run and silently
    ; swallowing their output. The other capture tests in this class already guard;
    ; this one did not.
    Set tCapBase = "", tCapParent = "", tCaught = 0
    Set tInitIO = ..StartCapture()
    Try {
        Set tScBase = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tCaught = 1
        Set tExMsg = ex.DisplayString()
    }
    Set tCapBase = ..StopCapture(tInitIO)

    Set tInitIO = ..StartCapture()
    Try {
        Set tScParent = ##class(%Atelier.REST).RenderResponseBody($$$OK, , tResult)
    } Catch ex2 {
        Set tCaught = 1
        Set tExMsg = ex2.DisplayString()
    }
    Set tCapParent = ..StopCapture(tInitIO)

    Do $$$AssertTrue('tCaught, "neither implementation may throw on the success path: "_$Get(tExMsg))
    Do $$$AssertStatusOK($Get(tScBase), "Base.RenderResponseBody should return OK on the success path")
    Do $$$AssertStatusOK($Get(tScParent), "%Atelier.REST.RenderResponseBody should return OK")
    ; Non-emptiness FIRST: without it this comparison is satisfied by "" = "" — two
    ; captures that both failed to record anything (a silently unbound mnemonic, or
    ; both implementations writing nothing) would render the story's only structural
    ; back-compat proof for all 15 handlers vacuous.
    Do $$$AssertTrue($Length(tCapBase) > 0, "the Base capture must be non-empty, or the byte-identity comparison below proves nothing")
    Do $$$AssertTrue(tCapBase [ """output"":""hello""", "the Base capture must contain the real payload: ["_tCapBase_"]")
    Do $$$AssertEquals(tCapBase, tCapParent, "Base's success-path bytes must be byte-identical to the inherited implementation")
    Quit $$$OK
}

/// AC 34.4.4 / Rule #58 — byte-identity pinned across NON-canonical payload shapes, not
/// only the flat two-key ASCII object above. A canonical-only fixture set is blind by
/// construction: an override that re-serialized through its own formatter, mishandled
/// wide characters (the one place stream serialization and device output can diverge),
/// or dropped a populated console part would pass a single simple fixture and still
/// break real responses. Each shape is compared against the inherited implementation.
Method TestSuccessPathByteIdenticalAcrossPayloadShapes() As %Status
{
    ; 1) populated pMsgPart (the console part — omitted at 100% of this package's call
    ;    sites, but reachable through the inherited ServeDoc/ServeXml entry points).
    Set tMsg = []
    Do tMsg.%Push("first console line")
    Do tMsg.%Push("second console line")
    ; 2) wide/non-ASCII characters and JSON metacharacters.
    Set tWide = {}
    Do tWide.%Set("unicode", "café — 日本語 — Ω")
    Do tWide.%Set("quoted", "he said ""hi"" \ backslash")
    Do tWide.%Set("control", "tab"_$Char(9)_"newline"_$Char(10))
    ; 3) an ARRAY-typed result part and a nested structure.
    Set tNested = {}
    Do tNested.%Set("rows", ["a", "b", "c"])
    Do tNested.%Set("deep", {"level1":{"level2":{"level3":"bottom"}}})
    Do tNested.%Set("emptyArr", [])
    Do tNested.%Set("nullish", "")

    Set tShapes = 0
    For tCase = 1:1:3 {
        Set tMsgArg = ""
        If tCase = 1 { Set tMsgArg = tMsg, tResArg = {} }
        If tCase = 2 { Set tResArg = tWide }
        If tCase = 3 { Set tResArg = tNested }

        Set tCaught = 0
        Set tInitIO = ..StartCapture()
        Try {
            If tCase = 1 {
                Set tScB = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$OK, tMsgArg, tResArg)
            } Else {
                Set tScB = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$OK, , tResArg)
            }
        } Catch exB {
            Set tCaught = 1
            Set tExMsg = exB.DisplayString()
        }
        Set tCapB = ..StopCapture(tInitIO)

        Set tInitIO = ..StartCapture()
        Try {
            If tCase = 1 {
                Set tScP = ##class(%Atelier.REST).RenderResponseBody($$$OK, tMsgArg, tResArg)
            } Else {
                Set tScP = ##class(%Atelier.REST).RenderResponseBody($$$OK, , tResArg)
            }
        } Catch exP {
            Set tCaught = 1
            Set tExMsg = exP.DisplayString()
        }
        Set tCapP = ..StopCapture(tInitIO)

        Do $$$AssertTrue('tCaught, "shape "_tCase_" must not throw: "_$Get(tExMsg))
        Do $$$AssertStatusOK($Get(tScB), "shape "_tCase_": Base must return OK")
        Do $$$AssertStatusOK($Get(tScP), "shape "_tCase_": parent must return OK")
        Do $$$AssertTrue($Length(tCapB) > 0, "shape "_tCase_": the Base capture must be non-empty")
        Do $$$AssertEquals(tCapB, tCapP, "shape "_tCase_": Base's bytes must be byte-identical to the inherited implementation")
        Set tShapes = tShapes + 1
    }
    Do $$$AssertEquals(tShapes, 3, "all three non-canonical payload shapes must have been compared")
    Quit $$$OK
}

/// Regression pin for a real defect caught live during Story 34.4 dev: every
/// "Do ..RenderResponseBody(status, , result)" call site (the overwhelming majority of
/// the 745 call sites this story's base class intercepts) omits pMsgPart POSITIONALLY,
/// leaving it genuinely UNDEFINED. An earlier version of this override referenced
/// pMsgPart directly ("Set tMsgPart = pMsgPart") before applying $Get(), which threw
/// <UNDEFINED> — silently, because every caller uses the "Do" form that discards the
/// returned %Status — producing a completely empty HTTP 200 response body on every
/// route in the package. Caught via a live curl/MCP-tool smoke against a real running
/// instance, not by this suite (which cannot fabricate %request/%response context for
/// an end-to-end REST call) — this test pins the reachable, request-context-free
/// symptom so the exact regression class cannot silently return.
Method TestSuccessPathWithOmittedMsgPart() As %Status
{
    Set tResult = {}
    Do tResult.%Set("output", "hi")

    Set tInitIO = ..StartCapture()
    Set tCaught = 0
    Try {
        Set tSC = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tCaught = 1
        Set tExMsg = ex.DisplayString()
    }
    Set tCap = ..StopCapture(tInitIO)

    Do $$$AssertTrue('tCaught, "omitting pMsgPart must not throw: "_$Get(tExMsg))
    Do $$$AssertStatusOK($Get(tSC), "omitting pMsgPart must still return OK: "_$System.Status.GetErrorText($Get(tSC)))
    Do $$$AssertTrue(tCap [ "{""status"":{""errors"":[],""summary"":""""}", "response must contain the real envelope, not be empty: ["_tCap_"]")
    Do $$$AssertTrue(tCap [ """output"":""hi""", "response must contain the actual result payload: ["_tCap_"]")
    Quit $$$OK
}

/// Both pMsgPart and pResPart omitted — the shape used by every early-validation
/// error one-liner across the 15 handlers (e.g. "Do ..RenderResponseBody(tSC)").
Method TestSuccessPathWithBothPartsOmitted() As %Status
{
    Set tInitIO = ..StartCapture()
    Set tCaught = 0
    Try {
        Set tSC = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$ERROR($$$GeneralError, "probe error"))
    } Catch ex {
        Set tCaught = 1
        Set tExMsg = ex.DisplayString()
    }
    Set tCap = ..StopCapture(tInitIO)

    Do $$$AssertTrue('tCaught, "omitting both parts must not throw: "_$Get(tExMsg))
    Do $$$AssertTrue(tCap [ "probe error", "response must carry the real error text: ["_tCap_"]")
    Do $$$AssertTrue(tCap [ """result"":{}", "response must default result to an empty object: ["_tCap_"]")
    Quit $$$OK
}

/// AC 34.4.1: when the result part cannot be JSON-serialized, the pre-flight catches
/// it BEFORE any byte reaches the device and substitutes a minimal, guaranteed-
/// serializable error envelope — never a truncated/partial one. %ToJSON() on a
/// %DynamicObject property holding a plain OREF (not itself a dynamic entity or a
/// stream) throws <METHOD NOT SUPPORTED>, verified live against this instance
/// (2026.1 Build 235U) before writing this test, per Rule #16 — a real, reproducible
/// serialization failure, not a fabricated one.
Method TestPreflightFailureSubstitutesMinimalErrorEnvelope() As %Status
{
    Set tBad = {}
    Set tOref = ##class(%Exception.General).%New()
    Set tBad."unserializable" = tOref

    Set tInitIO = ..StartCapture()
    Set tCaught = 0
    Try {
        Set tSC = ##class(ExecuteMCPv2.REST.Base).RenderResponseBody($$$OK, , tBad)
    } Catch ex {
        Set tCaught = 1
        Set tExMsg = ex.DisplayString()
    }
    Set tCap = ..StopCapture(tInitIO)

    Do $$$AssertTrue('tCaught, "a preflight failure must never throw out of RenderResponseBody: "_$Get(tExMsg))
    Do $$$AssertStatusOK($Get(tSC), "the substituted envelope must still render as OK (HTTP 200 with an error status INSIDE the envelope, matching the rest of the package's pattern): "_$System.Status.GetErrorText($Get(tSC)))

    ; The substituted envelope must be well-formed JSON with an empty result — proof
    ; that NOTHING from the unserializable payload leaked through and the response is
    ; a single clean envelope, never a truncated one.
    Set tParsed = ""
    Set tParseCaught = 0
    Try {
        Set tParsed = ##class(%DynamicObject).%FromJSON(tCap)
    } Catch {
        Set tParseCaught = 1
    }
    Do $$$AssertTrue('tParseCaught, "the substituted envelope must be well-formed JSON: ["_tCap_"]")
    Do $$$AssertTrue($IsObject(tParsed), "parsed envelope must be an object")
    Do $$$AssertTrue(tParsed.status.errors.%Size() > 0, "the substituted envelope must carry a real error, not a silent OK")
    ; Rule #9: the real failure text (not a generic mask) must be preserved.
    Do $$$AssertTrue(tParsed.status.summary [ "METHOD NOT SUPPORTED", "the real %ToJSON failure text must survive SanitizeError: ["_tParsed.status.summary_"]")
    Quit $$$OK
}

/// Pins that EVERY ExecuteMCPv2.REST.* handler extends the new base class.
/// <p>The ENUMERATION is mechanical, not hand-maintained (Rules #51/#56): the class
/// list is read from <class>%Dictionary.ClassDefinition</class> at run time, so a
/// 16th handler shipped tomorrow extending <class>%Atelier.REST</class> directly
/// FAILS this test. An earlier revision asserted <method>%Extends</method> over a
/// literal <code>$ListBuild</code> of 15 names closed by
/// <code>$$$AssertEquals($ListLength(tHandlers), 15)</code> — a live hierarchy read
/// over a dead enumeration, which cannot see a class nobody added to the literal and
/// whose closing assertion compared a literal against its own length. The two
/// deliberate exclusions are named explicitly and asserted below.</p>
Method TestAllFifteenHandlersExtendBase() As %Status
{
    Set tCount = 0
    Set tStmt = ##class(%SQL.Statement).%New()
    Set tSC = tStmt.%Prepare("SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ? ORDER BY Name")
    Do $$$AssertStatusOK(tSC, "the handler enumeration query must prepare")
    Set tRS = tStmt.%Execute("ExecuteMCPv2.REST.")
    While tRS.%Next() {
        Set tName = tRS.%Get("Name")
        ; Base itself is the superclass; Dispatch is the deliberate non-re-parent
        ; pinned by TestDispatchDeliberatelyNotReParented.
        If (tName = "ExecuteMCPv2.REST.Base") || (tName = "ExecuteMCPv2.REST.Dispatch") Continue
        Set tCount = tCount + 1
        Do $$$AssertTrue($ClassMethod(tName, "%Extends", "ExecuteMCPv2.REST.Base"), tName_" must extend ExecuteMCPv2.REST.Base")
    }
    ; The count is a cross-check on the mechanical enumeration itself: if the query
    ; silently returned nothing, the loop above would vacuously pass.
    Do $$$AssertEquals(tCount, 15, "exactly 15 ExecuteMCPv2.REST.* handlers (excluding Base and Dispatch) are expected")
    Quit $$$OK
}

/// Pins the explicit Story 34.4 decision NOT to re-parent Dispatch.cls: it has zero
/// RenderResponseBody call sites (verified live at story-start via grep), so
/// re-parenting would add compile-order/coverage surface with no correctness benefit.
Method TestDispatchDeliberatelyNotReParented() As %Status
{
    Do $$$AssertTrue('$ClassMethod("ExecuteMCPv2.REST.Dispatch", "%Extends", "ExecuteMCPv2.REST.Base"), "Dispatch.cls is deliberately NOT re-parented (zero RenderResponseBody call sites)")
    ; Read the DIRECT superclass from the dictionary, not %Extends("%Atelier.REST"):
    ; because Base itself extends %Atelier.REST, an %Extends check stays true even if
    ; Dispatch WERE re-parented onto Base, so it could never fail independently of the
    ; assertion above — a vacuous pin of the very decision this test exists to record.
    Set tDef = ##class(%Dictionary.ClassDefinition).%OpenId("ExecuteMCPv2.REST.Dispatch")
    Do $$$AssertTrue($IsObject(tDef), "Dispatch.cls class definition must be readable")
    Do $$$AssertEquals(tDef.Super, "%Atelier.REST", "Dispatch.cls must still extend %Atelier.REST DIRECTLY")
    Quit $$$OK
}

/// I/O redirect entry points for <method>StartCapture</method>/<method>StopCapture</method>.
/// <p>Referenced by the mnemonic routine bound via <code>Use tNull::("^"_$ZNAME)</code>
/// in <method>StartCapture</method> — must live in THIS class's own compiled routine
/// (same pattern as <method>ExecuteMCPv2.REST.Command.Redirects</method>) for
/// <code>$ZNAME</code> to resolve them. Accumulates into the process-private
/// <var>%BaseTestCap</var>.</p>
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) Set %BaseTestCap = $Get(%BaseTestCap, "") _ s Quit
wchr(a) Set %BaseTestCap = $Get(%BaseTestCap, "") _ $Char(a) Quit
wnl Set %BaseTestCap = $Get(%BaseTestCap, "") _ $Char(10) Quit
wff Set %BaseTestCap = $Get(%BaseTestCap, "") _ $Char(12) Quit
wtab(n) New chars Set $Piece(chars, " ", n+1) = "" Set %BaseTestCap = $Get(%BaseTestCap, "") _ chars Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

}
