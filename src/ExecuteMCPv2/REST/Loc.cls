/// <p>REST handler for developer tooling endpoints (Epic 22, Story 22.0).</p>
/// <p>Thin surface over the <class>ExecuteMCPv2.Loc.Generate</class> facade:
/// validate → delegate → render. Follows the project handler conventions
/// (Rules #7/#8/#9/#33): explicit namespace save/restore (never
/// <code>New $NAMESPACE</code>; the catch path restores first), exactly one
/// <method>RenderResponseBody</method> per request path, and
/// <method>ExecuteMCPv2.Utils:SanitizeError</method> on every error status.</p>
Class ExecuteMCPv2.REST.Loc Extends %Atelier.REST
{

/// Count lines of code for the documents matching a caller-supplied spec.
/// <p>Query parameters:
/// <ul>
///   <li><code>spec</code> — REQUIRED document spec (comma-delimited,
///       <code>*</code>/<code>?</code> wildcards; e.g.
///       <code>MyPkg.*.cls,*.mac</code>). Whole-namespace scans require an
///       explicit <code>*</code> (decision D2).</li>
///   <li><code>namespace</code> — target namespace (default: current)</li>
///   <li><code>includeGenerated</code> — 0/1/true/false (default 0; decision D7)</li>
///   <li><code>topN</code> — top-N largest documents in the response
///       (default 20, clamped to 1..100; decision D5)</li>
/// </ul></p>
ClassMethod LocCount() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSpec = $ZStrip($Get(%request.Data("spec",1)), "<>W")
        Set tNamespace = $Get(%request.Data("namespace",1))
        Set tIncludeGeneratedRaw = $ZConvert($Get(%request.Data("includeGenerated",1)), "L")
        Set tTopNRaw = $Get(%request.Data("topN",1))

        ; spec is REQUIRED (decision D2 — no implicit whole-namespace scan)
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tSpec, "spec")
        If $$$ISERR(tSC) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; includeGenerated: 0/1/true/false, default false when omitted
        Set tIncludeGenerated = 0
        If tIncludeGeneratedRaw '= "" {
            If (tIncludeGeneratedRaw = "1") || (tIncludeGeneratedRaw = "true") {
                Set tIncludeGenerated = 1
            } ElseIf (tIncludeGeneratedRaw '= "0") && (tIncludeGeneratedRaw '= "false") {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'includeGenerated' must be one of: 0, 1, true, false")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
        }

        ; topN: positive integer, default 20, clamped to 1..100
        Set tTopN = 20
        If tTopNRaw '= "" {
            If tTopNRaw '? 1.N {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'topN' must be a positive integer")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tTopN = +tTopNRaw
            If tTopN < 1 Set tTopN = 1
            If tTopN > 100 Set tTopN = 100
        }

        ; switch to the target namespace (explicit save/restore — Rule #7)
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; delegate to the LOC library facade
        Set tOptions = {}
        Do tOptions.%Set("includeGenerated", tIncludeGenerated, "boolean")
        Do tOptions.%Set("topN", tTopN, "number")
        Set tResult = ""
        Set tSC = ##class(ExecuteMCPv2.Loc.Generate).Count(tNamespace, tSpec, tOptions, .tResult)
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
