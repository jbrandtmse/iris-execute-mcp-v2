/// IPM-only install guard for the ExecuteMCPv2 package.
/// <p>The IPM module <code>iris-execute-mcp-v2</code> preloads this class and runs <method>Check</method>
/// at the end of the module's Initialize phase, before IPM reloads any package class. <method>Check</method>
/// orders the marker of the <class>ExecuteMCPv2.Setup</class> deployed in the namespace against this
/// package's marker and refuses the install when the deployed classes are newer, cannot be ordered, or
/// cannot be read, so that an IPM install never downgrades a deployment from a newer build.</p>
/// <p>The class is deliberately self-contained: it references no other ExecuteMCPv2 class, so it compiles
/// alone in IPM's preload. It is not part of the bootstrapped class set, and the MCP servers never deploy
/// it. Its presence in a namespace therefore means that IPM installed the classes there, and a server
/// bootstrap leaves such a deployment alone.</p>
/// <p><method>Classify</method> is a port of <code>classifyDeployedMarker</code> in
/// <code>packages/shared/src/bootstrap-version.ts</code>, which owns the marker grammar and ordering. The
/// IPM install path has no TypeScript, so the port is the only copy; a parity check over a shared table of
/// cases keeps the two equal.</p>
Class ExecuteMCPv2.InstallGuard Extends %RegisteredObject
{

/// This package's bootstrap version marker, <code>&lt;semver&gt;+&lt;sequence&gt;.&lt;hash&gt;</code>.
/// <p>The value on disk is <code>"dev"</code>, a placeholder. <code>scripts/gen-bootstrap.mjs</code>
/// stamps the real marker into the copy it embeds and packages, and this file is not edited for it.</p>
Parameter BOOTSTRAPVERSION = "dev";

/// The class whose compiled BOOTSTRAPVERSION parameter is the deployed marker.
Parameter SETUPCLASS = "ExecuteMCPv2.Setup";

/// The longest marker a message echoes.
Parameter MAXECHO = 80;

/// Whether <var>pText</var> is a non-empty string of the ASCII digits 0 to 9, and nothing else.
/// <p>The test is by character code, so a digit of another script never counts.</p>
ClassMethod IsDigits(pText As %String) As %Boolean
{
    Set tResult = ($Length(pText) > 0)
    For tIndex = 1:1:$Length(pText) {
        Set tCode = $Ascii(pText, tIndex)
        If (tCode < 48) || (tCode > 57) {
            Set tResult = 0
            Quit
        }
    }
    Quit tResult
}

/// Whether <var>pText</var> is exactly 12 lowercase hexadecimal digits (0-9 and a-f).
ClassMethod IsHash(pText As %String) As %Boolean
{
    Set tResult = ($Length(pText) = 12)
    If tResult {
        For tIndex = 1:1:12 {
            Set tCode = $Ascii(pText, tIndex)
            If '(((tCode >= 48) && (tCode <= 57)) || ((tCode >= 97) && (tCode <= 102))) {
                Set tResult = 0
                Quit
            }
        }
    }
    Quit tResult
}

/// Split a marker in the current grammar, <code>&lt;major&gt;.&lt;minor&gt;.&lt;patch&gt;+&lt;sequence&gt;.&lt;hash&gt;</code>.
/// <p>Returns 1 and sets <var>pParts</var>(1) to <var>pParts</var>(3) (the semver), <var>pParts</var>(4)
/// (the sequence) and <var>pParts</var>(5) (the hash) when <var>pMarker</var> is in that grammar, and 0
/// otherwise.</p>
ClassMethod ParseStamped(pMarker As %String, Output pParts) As %Boolean
{
    Kill pParts
    Set tSemver = $Piece(pMarker, "+", 1)
    Set tBuild = $Piece(pMarker, "+", 2)
    Set tResult = ($Length(pMarker, "+") = 2) && ($Length(tSemver, ".") = 3) && ($Length(tBuild, ".") = 2)
    If tResult {
        For tIndex = 1:1:3 {
            Set pParts(tIndex) = $Piece(tSemver, ".", tIndex)
            If '..IsDigits(pParts(tIndex)) Set tResult = 0
        }
        Set pParts(4) = $Piece(tBuild, ".", 1)
        Set pParts(5) = $Piece(tBuild, ".", 2)
        If '..IsDigits(pParts(4)) Set tResult = 0
        If '..IsHash(pParts(5)) Set tResult = 0
    }
    Quit tResult
}

/// Remove the leading zeros of a digit string, keeping a single 0 for a value of zero.
ClassMethod StripZeros(pDigits As %String) As %String
{
    Set tIndex = 1
    While (tIndex < $Length(pDigits)) && ($Extract(pDigits, tIndex) = "0") {
        Set tIndex = tIndex + 1
    }
    Quit $Extract(pDigits, tIndex, $Length(pDigits))
}

/// Compare two digit strings as unbounded integers: -1, 0 or 1.
/// <p>The comparison is by digit string, so a number past 2^53 still orders correctly: strip the leading
/// zeros, then the longer string is greater, then the strings compare as text.</p>
ClassMethod CompareDigits(pLeft As %String, pRight As %String) As %Integer
{
    Set tLeft = ..StripZeros(pLeft)
    Set tRight = ..StripZeros(pRight)
    Set tOrder = 0
    If $Length(tLeft) '= $Length(tRight) {
        Set tOrder = $Select($Length(tLeft) < $Length(tRight): -1, 1: 1)
    } ElseIf tLeft '= tRight {
        Set tOrder = $Select(tRight ] tLeft: -1, 1: 1)
    }
    Quit tOrder
}

/// How the deployed marker relates to the embedded one: <code>current</code>, <code>older</code>,
/// <code>newer</code> or <code>foreign</code>.
/// <ul>
/// <li><code>current</code>: the same marker.</li>
/// <li><code>older</code>: a bare 12-hex marker (a build that predates the sequence), a lower semver, or the
/// same semver with a lower sequence.</li>
/// <li><code>newer</code>: a higher semver, or the same semver with a higher sequence.</li>
/// <li><code>foreign</code>: the same semver and sequence with a different hash, the <code>dev</code>
/// placeholder, or any value in neither grammar. An embedded marker that is not in the current grammar
/// orders nothing, so a deployed value other than the identical one is foreign.</li>
/// </ul>
ClassMethod Classify(pDeployed As %String, pEmbedded As %String) As %String
{
    If pDeployed = pEmbedded Quit "current"
    If '..ParseStamped(pEmbedded, .tEmbedded) Quit "foreign"
    If ..IsHash(pDeployed) Quit "older"
    If '..ParseStamped(pDeployed, .tDeployed) Quit "foreign"
    Set tOrder = 0
    For tIndex = 1:1:4 {
        Set tOrder = ..CompareDigits(tDeployed(tIndex), tEmbedded(tIndex))
        If tOrder '= 0 Quit
    }
    If tOrder < 0 Quit "older"
    If tOrder > 0 Quit "newer"
    Quit $Select(tDeployed(5) = tEmbedded(5): "current", 1: "foreign")
}

/// What the namespace holds for <class>ExecuteMCPv2.Setup</class>.
/// <ul>
/// <li><code>absent</code>: no class definition. <var>pMarker</var> is empty.</li>
/// <li><code>marker</code>: the class is compiled and carries a non-empty BOOTSTRAPVERSION. <var>pMarker</var>
/// is that value.</li>
/// <li><code>unknown</code>: anything else (defined but not compiled, or no parameter, or an empty one).
/// <var>pMarker</var> is empty.</li>
/// </ul>
ClassMethod DeployedState(Output pMarker As %String) As %String
{
    Set pMarker = ""
    Set tState = "unknown"
    Try {
        If '##class(%Dictionary.ClassDefinition).%ExistsId(..#SETUPCLASS) {
            Set tState = "absent"
        } ElseIf ##class(%Dictionary.CompiledClass).%ExistsId(..#SETUPCLASS) {
            Set tMarker = $Parameter(..#SETUPCLASS, "BOOTSTRAPVERSION")
            If tMarker '= "" {
                Set pMarker = tMarker
                Set tState = "marker"
            }
        }
    } Catch ex {
        Set pMarker = ""
        Set tState = "unknown"
    }
    Quit tState
}

/// A marker for a message: quoted, and cut at <parameter>MAXECHO</parameter> characters.
ClassMethod Echo(pMarker As %String) As %String
{
    Set tText = $Extract(pMarker, 1, ..#MAXECHO)
    If $Length(pMarker) > ..#MAXECHO Set tText = tText _ "..."
    Quit """" _ tText _ """"
}

/// The text of a refusal. <var>pRelation</var> is <code>newer</code>, <code>foreign</code> or
/// <code>unknown</code>; <var>pMarker</var> is the deployed marker when one was read.
ClassMethod RefusalText(pRelation As %String, pMarker As %String) As %String
{
    Set tText = "ExecuteMCPv2.InstallGuard refused the install in namespace '" _ $NAMESPACE _ "': "
    Set tOwn = "this package's marker " _ ..Echo(..#BOOTSTRAPVERSION)
    Set tDeliberate = "To install this package deliberately, delete class ExecuteMCPv2.Setup in '" _ $NAMESPACE _ "' and run the install again."
    If pRelation = "newer" {
        Set tText = tText _ "the deployed ExecuteMCPv2.Setup marker " _ ..Echo(pMarker) _ " is newer than " _ tOwn
        Set tText = tText _ ", and nothing was installed. Install a package at least as new as the deployed classes."
    } ElseIf pRelation = "foreign" {
        Set tText = tText _ "the deployed ExecuteMCPv2.Setup marker " _ ..Echo(pMarker) _ " cannot be ordered against " _ tOwn
        Set tText = tText _ ", and nothing was installed. " _ tDeliberate
    } Else {
        Set tText = tText _ "no marker could be read from the deployed ExecuteMCPv2.Setup class, so it cannot be ordered against " _ tOwn
        Set tText = tText _ ", and nothing was installed. " _ tDeliberate
    }
    Quit tText
}

/// The IPM Invoke target, run at the end of Initialize. Returns an error, which aborts the install, when the
/// deployed <class>ExecuteMCPv2.Setup</class> is newer than this package, cannot be ordered against it, or
/// cannot be read. An absent, older or identical deployment returns <code>$$$OK</code>. Any failure of the
/// check itself refuses the install.
ClassMethod Check() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tState = ..DeployedState(.tMarker)
        Set tRelation = $Select(tState = "marker": ..Classify(tMarker, ..#BOOTSTRAPVERSION), 1: tState)
        If (tRelation = "newer") || (tRelation = "foreign") || (tRelation = "unknown") {
            Set tSC = $$$ERROR($$$GeneralError, ..RefusalText(tRelation, tMarker))
        }
    } Catch ex {
        Set tSC = $$$ERROR($$$GeneralError, ..RefusalText("unknown", "") _ " The check itself failed: " _ ex.DisplayString())
    }
    Quit tSC
}

}
