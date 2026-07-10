/// REST handler for the environment-diff document-hash endpoint (Epic 27, Story 27.0).
/// <p>Backs the custom REST endpoint <code>/api/executemcp/v2/dev/doc/hashes</code>
/// (<method>DocHashes</method>, GET query params or POST JSON body). Returns
/// SHA-256 content hashes of ObjectScript documents (CLS/MAC/INT/INC, matching
/// <class>ExecuteMCPv2.Loc.Scanner</class>'s scope) matching a caller-supplied
/// spec, so <code>iris_env_diff</code> (Story 27.0 TS tool) can compare source
/// across two IRIS profiles without exporting/downloading full source.</p>
/// <p>Document enumeration inlines the same <code>%RoutineMgr:StudioOpenDialog</code>
/// query <class>ExecuteMCPv2.Loc.Scanner</class>:<method>EnumerateDocs</method> uses
/// (Rule #47) rather than calling it directly, because this endpoint ALSO needs the
/// query's own <code>Date</code> column (ROWSPEC "Date:%TimeStamp:Date/Time last
/// modified" — <code>irislib/%Library/RoutineMgr.cls:1112</code>) for the response's
/// <code>timestamp</code> field, which <method>EnumerateDocs</method>'s narrower
/// output shape (names only) does not expose — this avoids an N+1 per-document
/// timestamp lookup (Rule #38 scan-cost discipline).</p>
/// <p><b>SHA-256 (Rule #16 PROBE-PINNED, live-verified against openssl ground truth):</b>
/// <code>$SYSTEM.Encryption.SHAHash(256, text)</code> returns the digest as RAW BYTES
/// (32 bytes, one byte per character) — NOT hex. <code>$SYSTEM.Encryption.ToHex
/// (rawHash)</code> (the class's own documented conversion helper) produces the
/// correct 64-character hex digest, confirmed byte-for-byte against
/// <code>openssl dgst -sha256</code> for both the empty string and "hello", and
/// round-trips through <code>FromHex</code>. <b><code>$ZCONVERT(hash,"O","HEX")</code>
/// does NOT work</b> — probed live and confirmed it throws
/// <code>&lt;ILLEGAL VALUE&gt;</code> (not a valid $ZCONVERT output code on this
/// instance); do not use it despite it being a plausible-looking alternative.</p>
Class ExecuteMCPv2.REST.EnvSync Extends %Atelier.REST
{

/// Document-hash endpoint: SHA-256 content hash + last-modified timestamp per
/// document matching <var>spec</var> (Story 27.0, AC 27.0.2).
/// <p>Query parameters (GET) / JSON body (POST):
/// <ul>
///   <li><code>spec</code> — REQUIRED document spec (comma-delimited,
///       <code>*</code>/<code>?</code> wildcards; e.g. <code>MyPkg.*.cls,*.mac</code>).
///       A bare <code>*</code> (or any comma-part equal to <code>*</code>) is
///       refused unless <code>allowWide</code> is also passed (Rule #38 —
///       whole-namespace scans risk the ~60s Web Gateway timeout).</li>
///   <li><code>namespace</code> — target namespace (default: current)</li>
///   <li><code>allowWide</code> — 0/1/true/false (default false); permits a
///       wide (bare <code>*</code>-part) spec when true.</li>
///   <li><code>includeGenerated</code> — 0/1/true/false (default false);
///       include compiler-generated documents (mirrors the LOC tool's D7).</li>
/// </ul></p>
/// <p>Response shape: <code>{ "documents": [ {"name","hash","timestamp"}, ... ],
/// "count": N }</code>. There is no output cap — every matching document is
/// scanned and hashed (Rule #38: the caller controls scan cost via
/// <var>spec</var> + <var>allowWide</var>, not a post-hoc result limit).</p>
ClassMethod DocHashes() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tOrigNS = $NAMESPACE
    Set tErrored = 0
    Try {
        ; ---- Parse params from %request (GET query or POST body) BEFORE any namespace switch ----
        Set tSpec = "", tNamespace = "", tAllowWideRaw = "", tIncludeGeneratedRaw = ""
        If (%request.Method = "POST") {
            Set tSC1 = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
            If $$$ISERR(tSC1) {
                Set tErrored = 1
                Set tCmdStatus = tSC1
                Quit
            }
            If $IsObject(tBody) {
                If tBody.%IsDefined("spec") Set tSpec = tBody.%Get("spec")
                If tBody.%IsDefined("namespace") Set tNamespace = tBody.%Get("namespace")
                If tBody.%IsDefined("allowWide") Set tAllowWideRaw = tBody.%Get("allowWide")
                If tBody.%IsDefined("includeGenerated") Set tIncludeGeneratedRaw = tBody.%Get("includeGenerated")
            }
        } Else {
            Set tSpec = $Get(%request.Data("spec",1))
            Set tNamespace = $Get(%request.Data("namespace",1))
            Set tAllowWideRaw = $Get(%request.Data("allowWide",1))
            Set tIncludeGeneratedRaw = $Get(%request.Data("includeGenerated",1))
        }

        Set tAllowWide = ..CoerceBoolean(tAllowWideRaw)
        Set tIncludeGenerated = ..CoerceBoolean(tIncludeGeneratedRaw)

        ; switch to the target namespace (explicit save/restore — Rule #7)
        If tNamespace '= "" {
            Set tSC2 = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC2) {
                Set tErrored = 1
                Set tCmdStatus = tSC2
                Quit
            }
        }

        Set tSC3 = ..ComputeHashes(tSpec, tAllowWide, tIncludeGenerated, .tResult)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC3) {
            Set tErrored = 1
            Set tCmdStatus = tSC3
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

/// Coerce a raw 0/1/true/false string (or a JSON boolean/number's string form)
/// to a %Boolean. Anything not recognized as truthy is 0 — a safe default: an
/// unrecognized/omitted <var>allowWide</var> value never silently permits a
/// wide scan, and an unrecognized <var>includeGenerated</var> value keeps the
/// D7 exclude-by-default behavior.
ClassMethod CoerceBoolean(pRaw As %String) As %Boolean
{
    Set tLower = $ZConvert(pRaw, "L")
    Quit ((tLower = "1") || (tLower = "true"))
}

/// Rule #38 gate: refuse a wide/whole-namespace spec (any comma-delimited part
/// equal to a bare <code>*</code>) unless <var>pAllowWide</var>. Split out from
/// <method>ComputeHashes</method> so the refusal/permit decision is
/// unit-testable in isolation, WITHOUT ever running the (potentially large and
/// slow — the very thing this gate exists to guard against) actual scan; the
/// full whole-namespace-scan PERMIT path is a live-smoke concern, not a fast
/// automated-suite concern (mirrors the Epic 22 <code>iris_loc_count</code>
/// SADEMO 504 lead-smoke precedent).
ClassMethod CheckWideSpec(pSpec As %String, pAllowWide As %Boolean = 0) As %Status
{
    Set tIsWide = 0
    For tI = 1:1:$Length(pSpec, ",") {
        If $ZStrip($Piece(pSpec, ",", tI), "<>W") = "*" Set tIsWide = 1
    }
    If tIsWide && 'pAllowWide {
        Quit $$$ERROR($$$GeneralError, "spec '"_pSpec_"' scans the whole namespace; pass allowWide:true to override. A large namespace may hit the ~60s Web Gateway timeout -- prefer a package-scoped spec.")
    }
    Quit $$$OK
}

/// Core hashing logic (Rule #7's <var>%request</var>-independent seam —
/// unit-testable directly, no live CSP context required). Operates in the
/// CURRENT namespace (the caller switches beforehand, mirroring
/// <class>ExecuteMCPv2.Loc.Scanner</class>'s "current namespace" contract).
/// Validates <var>pSpec</var> is present and (unless <var>pAllowWide</var>)
/// refuses a whole-namespace spec (Rule #38), then enumerates + hashes every
/// matching document.
ClassMethod ComputeHashes(pSpec As %String, pAllowWide As %Boolean = 0, pIncludeGenerated As %Boolean = 0, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Try {
        Set tSpec = $ZStrip(pSpec, "<>W")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tSpec, "spec")
        If $$$ISERR(tSC) Quit

        ; Rule #38: reject a wide/whole-namespace spec unless allowWide — an output
        ; cap is NOT a scan cap; the caller controls scan cost via spec, not a
        ; post-hoc limit. Split into CheckWideSpec (below) so the refusal/permit
        ; GATE is unit-testable without ever running the (potentially large) scan.
        Set tSC = ..CheckWideSpec(tSpec, pAllowWide)
        If $$$ISERR(tSC) Quit

        Set tSC = ..EnumerateDocsWithDate(tSpec, pIncludeGenerated, .tNames, .tDates)
        If $$$ISERR(tSC) Quit

        Set tDocs = []
        Set tCount = +$Get(tNames)
        For tI = 1:1:tCount {
            Set tName = tNames(tI)
            Set tHashHex = ""
            Set tSC = ..HashDoc(tName, .tHashHex)
            If $$$ISERR(tSC) Quit
            Set tEntry = {}
            Do tEntry.%Set("name", tName)
            Do tEntry.%Set("hash", tHashHex)
            Do tEntry.%Set("timestamp", $Get(tDates(tI)))
            Do tDocs.%Push(tEntry)
        }
        If $$$ISERR(tSC) Quit

        Set pResult = {}
        Do pResult.%Set("documents", tDocs)
        Do pResult.%Set("count", tDocs.%Size(), "number")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Enumerate documents in the CURRENT namespace matching <var>pSpec</var>,
/// filtered to CLS/MAC/INT/INC (mirrors <class>ExecuteMCPv2.Loc.Scanner</class>
/// :<method>EnumerateDocs</method>'s exact <code>%RoutineMgr:StudioOpenDialog</code>
/// invocation — Rule #47), additionally capturing each document's
/// last-modified timestamp from the SAME query's own <code>Date</code> column
/// so no extra per-document lookup is needed (see class doc comment).
/// <p><var>pNames</var> — output: <var>pNames</var> = count,
/// <var>pNames</var>(1..n) = full document names. <var>pDates</var>(1..n) is a
/// parallel array holding the corresponding <code>%TimeStamp</code> string.</p>
ClassMethod EnumerateDocsWithDate(pSpec As %String, pIncludeGenerated As %Boolean = 0, Output pNames, Output pDates) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pNames
        Kill pDates
        Set pNames = 0
        Set tRS = ##class(%ResultSet).%New("%RoutineMgr:StudioOpenDialog")
        Set tSC = tRS.Execute(pSpec, 1, 1, 0, 1, 0, +pIncludeGenerated)
        If $$$ISERR(tSC) Quit
        Set tSCNext = $$$OK
        While tRS.Next(.tSCNext) {
            Set tName = tRS.Get("Name")
            Set tExt = $ZConvert($Piece(tName, ".", *), "L")
            If (tExt '= "cls") && (tExt '= "mac") && (tExt '= "int") && (tExt '= "inc") Continue
            Set pNames = pNames + 1
            Set pNames(pNames) = tName
            Set pDates(pNames) = tRS.Get("Date")
        }
        If $$$ISERR(tSCNext) Set tSC = tSCNext
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Compute the SHA-256 hash of one document's UDL source text as a stable hex
/// string (Rule #16 PROBE-PINNED — see class doc comment for the pinned API +
/// live openssl cross-check). Source lines are read via
/// <method>%Atelier.v1.Utils.TextServices:GetTextAsArray</method> (pFlags=0 =
/// UDL text) and joined with <code>$Char(10)</code> — this INCLUDES the storage
/// section, so storage-section drift counts as real drift (by design).
/// <p>Uses <code>SHAHash</code> on the joined string (fine for typical class
/// sizes, matching the LOC tool's non-streaming line handling); an
/// exceptionally large document would need <method>SHAHashStream</method>
/// instead — out of scope for this story.</p>
ClassMethod HashDoc(pDocName As %String, Output pHashHex As %String) As %Status
{
    Set tSC = $$$OK
    Set pHashHex = ""
    Try {
        Set tSC = ##class(%Atelier.v1.Utils.TextServices).GetTextAsArray(pDocName, 0, .tLines)
        If $$$ISERR(tSC) Quit
        Set tText = ""
        ; the line COUNT lives at tLines(0), NOT the bare/unsubscripted node
        ; (confirmed against ExecuteMCPv2.Loc.Classifier:ClassifyDoc's identical
        ; `+$Get(pLines(0))` read of the same GetTextAsArray output shape).
        Set tCount = +$Get(tLines(0))
        For tI = 1:1:tCount {
            Set tText = tText _ $Get(tLines(tI)) _ $Char(10)
        }
        Set tRawHash = $SYSTEM.Encryption.SHAHash(256, tText)
        Set pHashHex = $SYSTEM.Encryption.ToHex(tRawHash)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
