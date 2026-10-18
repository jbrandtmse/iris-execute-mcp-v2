/// Synthetic coverage oracle fixture (Story 40.1).
Class ExecuteMCPv2.Tests.CoverageFixture
{

ClassMethod Classify(pN As %Integer) As %String
{
    Set tResult = ""
    If pN < 0 {
        Set tResult = "negative"
    } ElseIf pN = 0 {
        Set tResult = "zero"
    } Else {
        Set tResult = "positive"
    }
    Quit tResult
}

ClassMethod SumTo(pN As %Integer) As %Integer
{
    Set tSum = 0
    For tI = 1:1:pN {
        Set tSum = tSum + tI
    }
    Quit tSum
}

ClassMethod Guarded(pFail As %Boolean) As %String
{
    Set tOut = "start"
    Try {
        If pFail {
            Throw ##class(%Exception.General).%New("ProbeFail")
        }
        Set tOut = "ok"
    } Catch ex {
        Set tOut = "caught"
    }
    Quit tOut
}

ClassMethod Unused() As %String
{
    // a comment line
    Set tX = 1
    Quit tX
}

ClassMethod Loop(pN As %Integer) As %Integer
{
    Set tI = 0
    While tI < pN {
        Set tI = tI + 1
    }
    Do {
        Set tI = tI - 1
    } While tI > 0
    Quit tI
}

ClassMethod OneLine() As %Integer
{
    Quit 42
}

ClassMethod Exercise() As %Status
{
    Do ..Classify(5)
    Do ..SumTo(3)
    Quit $$$OK
}

}
