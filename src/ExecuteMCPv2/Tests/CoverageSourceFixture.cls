Include %occStatus

/// Synthetic coverage-report fixture (Story 40.2).
Class ExecuteMCPv2.Tests.CoverageSourceFixture Extends %RegisteredObject
{

Property Score As %Integer;

Property Label As %String [ Calculated ];

Method ScoreSet(pValue As %Integer) As %Status
{
    Set i%Score = pValue * 2
    Quit $$$OK
}

Method LabelGet() As %String
{
    Quit "L"_..Score
}

ClassMethod Plain(pN As %Integer) As %Integer
{
    Set tX = pN + 1
    Quit tX
}

ClassMethod Macro(pSC As %Status) As %String
{
    If $$$ISERR(pSC) {
        Quit "error"
    }
    $$$ThrowOnError(pSC)
    #define Twice(%x) ((%x)*2)
    Set tY = $$$Twice(3)
    Quit "ok"
}

ClassMethod MultiLine(pA As %Integer) As %List
{
    Set tList = $ListBuild(pA,
        pA + 1,
        pA + 2)
    If (pA > 0) &&
        (pA < 10) {
        Set tList = tList_$ListBuild(0)
    }
    Quit tList
}

ClassMethod Sql(pName As %String) As %Integer
{
    Set tCount = 0
    &sql(SELECT COUNT(*) INTO :tCount FROM %Dictionary.ClassDefinition WHERE Name = :pName)
    If SQLCODE < 0 Quit -1
    Quit tCount
}

ClassMethod Generated() As %Integer [ CodeMode = objectgenerator ]
{
    Do %code.WriteLine(" Set tGen = 1")
    Do %code.WriteLine(" Quit tGen")
    Quit $$$OK
}

ClassMethod Expr(pN As %Integer) As %Integer [ CodeMode = expression ]
{
pN * 3
}

ClassMethod Constant() As %Integer
{
    Quit 42
}

ClassMethod Comments() As %Integer
{
    // a comment
    /* block
       comment */
    Set tY = 1 ; trailing
    Quit tY
}

ClassMethod TwoOnOne(pN As %Integer) As %Integer
{
    Set tA = 1  Set tB = 2
    Quit tA + tB + pN
}

}
