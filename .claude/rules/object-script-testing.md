# ObjectScript Testing Framework Knowledge

## IRIS %UnitTest Framework Core Concepts

### Available Assertion Macros
The %UnitTest.TestCase class provides these STANDARD macros (must use triple dollar signs $$$):
- `$$$AssertEquals(actual, expected, description)` - Assert two values are equal
- `$$$AssertNotEquals(actual, expected, description)` - Assert two values are not equal  
- `$$$AssertTrue(condition, description)` - Assert condition is true
- `$$$AssertStatusOK(status, description)` - Assert status is $$$OK
- `$$$AssertStatusNotOK(status, description)` - Assert status is not $$$OK

### IMPORTANT: Non-existent Macros
These macros DO NOT exist in %UnitTest.TestCase:
- ~~$$$AssertFalse~~ - Use `$$$AssertTrue('condition, description)` instead
- ~~$$$AssertCondition~~ - Use `$$$AssertTrue(condition, description)` instead

### Macro vs Method Distinction
- Assertions in %UnitTest.TestCase are MACROS not methods
- CORRECT: `Do $$$AssertEquals(1, 1, "test")`
- INCORRECT: `Do ..AssertEquals(1, 1, "test")`
- Custom methods can be added to subclasses but they are NOT macros

### Test Class Structure
```objectscript
Class MyPackage.MyTest Extends %UnitTest.TestCase
{
    // Test methods must start with "Test"
    Method TestSomething()
    {
        Do $$$AssertTrue(1=1, "Basic test")
        Quit
    }
    
    // Setup/teardown methods (optional)
    Method OnBeforeOneTest() As %Status { Quit $$$OK }
    Method OnAfterOneTest() As %Status { Quit $$$OK }
}
```

### Test Class Size
- Test class size should be limited to about 500 lines
- When necessary, divide larger test classes into smaller classes to comply with this rule.

### Critical Constructor (%OnNew) Requirements
**CRITICAL**: When extending %UnitTest.TestCase, you MUST properly handle the `initvalue` parameter:

```objectscript
/// Constructor must handle initvalue parameter from parent class
Method %OnNew(initvalue As %String = "") As %Status
{
    // Call parent constructor with initvalue parameter - REQUIRED
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    
    // Initialize any custom properties here
    Set ..MyProperty = ""
    
    Quit $$$OK
}
```

**Key %OnNew Requirements:**
1. **MUST accept initvalue parameter**: The parent %UnitTest.TestCase requires this
2. **MUST call ##super(initvalue)**: Pass initvalue to parent constructor
3. **NO Private keyword**: ERROR #5477 - %OnNew cannot be Private
4. **Check parent status**: Always check if ##super() succeeded

### MultiDimensional Property Restrictions
**CRITICAL**: MultiDimensional properties CANNOT have datatype specifications:

```objectscript
// INCORRECT - causes compilation error
Property MyData As %String [ MultiDimensional ];

// CORRECT - no datatype for MultiDimensional
Property MyData [ MultiDimensional ];
```

### Common Compilation Issues
1. **Multiline macros**: ObjectScript doesn't support multiline macro calls - keep on single line
2. **Undefined macros**: Using non-existent macros like $$$AssertFalse or $$$AssertCondition
3. **Method vs Macro confusion**: Using ..AssertX() instead of $$$AssertX()
4. **Parameter underscores**: Class parameters cannot contain underscores
5. **Private %OnNew**: ERROR #5477 - Constructor cannot have Private keyword
6. **MultiDimensional datatypes**: Cannot specify datatype for MultiDimensional properties

### Runtime Issues
1. **UNDEFINED errors in %OnNew**: Usually missing initvalue parameter handling
   - Error pattern: `<UNDEFINED> 9 %OnNew+1^%UnitTest.TestCase.1 initvalue`
   - Solution: Implement %OnNew with initvalue parameter
2. **initvalue errors**: Parent class expects initvalue in constructor
3. **Object initialization**: Initialize all properties in %OnNew to avoid UNDEFINED

### Debugging Test Issues
Use debug globals to trace execution:
```objectscript
// In your test or debug method
Set ^ClineDebug = ""
Set ^ClineDebug = ^ClineDebug _ "Step 1 completed; "
// Later retrieve with get_global tool
```

### Best Practices
1. Keep test methods focused and independent
2. Use descriptive assertion messages
3. Clean up test data in OnAfterOneTest
4. Use custom TestCase base class for project-specific assertions
5. Verify compilation before running tests
6. Use test fixtures for common test data
7. Always implement %OnNew properly when extending %UnitTest.TestCase
8. Use debug globals (^ClineDebug) to trace test execution issues