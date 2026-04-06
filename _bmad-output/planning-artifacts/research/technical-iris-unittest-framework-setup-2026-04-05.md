---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - architecture.md
  - prd.md
workflowType: 'research'
research_type: 'technical'
research_topic: 'IRIS %UnitTest Framework Setup and Configuration'
research_goals: 'Document ^UnitTestRoot global requirement and test execution configuration for automated unit testing in the iris-execute-mcp-v2 project'
user_name: 'Developer'
date: '2026-04-05'
web_research_enabled: true
source_verification: true
---

# Research Report: IRIS %UnitTest Framework Setup and Configuration

**Date:** 2026-04-05
**Author:** Developer (Mary - Business Analyst)
**Research Type:** Technical

---

## Research Overview

This document captures the required setup for the InterSystems IRIS `%UnitTest` framework, specifically the `^UnitTestRoot` global configuration and `%UnitTest.Manager` execution qualifiers. The goal is to ensure the iris-execute-mcp-v2 project can automatically configure the testing environment so that unit tests execute without manual setup or errors.

---

## 1. The `^UnitTestRoot` Global — What It Is and Why It Matters

### Purpose

The `^UnitTestRoot` global tells `%UnitTest.Manager.RunTest()` where to find test class files on the filesystem. It is a **mandatory prerequisite** — without it being set, `RunTest()` will fail.

### Key Characteristics

| Aspect | Detail |
|--------|--------|
| **Global name** | `^UnitTestRoot` |
| **Scope** | Namespace-specific — must be set in each namespace where tests run |
| **Value** | A valid filesystem directory path, OR empty string `""` |
| **When required** | Before any call to `%UnitTest.Manager.RunTest()` or related methods |
| **Default** | Not set — must be explicitly configured |

### Setting the Global

```objectscript
; Standard setup — point to a real directory
Set ^UnitTestRoot = "C:\InterSystems\IRIS\UnitTests"

; Pre-compiled classes already in memory — no directory needed
Set ^UnitTestRoot = ""
```

### Two Modes of Operation

1. **Directory-based loading** (`^UnitTestRoot` = valid path): `RunTest()` loads XML/UDL test files from the directory, compiles them, executes, then deletes them from memory by default.

2. **Pre-compiled / in-memory** (`^UnitTestRoot` = `""`): Tests are already compiled into the namespace. Use with `/noload` qualifier to skip the load phase entirely.

---

## 2. `%UnitTest.Manager.RunTest()` — Method Signature and Parameters

```objectscript
ClassMethod RunTest(
    testspec As %String = "",
    qualifiers As %String = "",
    userparam As %String = ""
) As %Status
```

### The `testspec` Parameter

The test specification controls which tests to run:

| Format | Meaning |
|--------|---------|
| `""` (empty) | Run all tests found in `^UnitTestRoot` |
| `"subdirectory"` | Run tests in that subdirectory of `^UnitTestRoot` |
| `"suite:PackageName.ClassName"` | Run a specific test class (when using `/noload`) |

### The `qualifiers` Parameter

A string of slash-prefixed flags that control execution behavior.

---

## 3. Critical Qualifiers for Our Use Case

Since the iris-execute-mcp-v2 project compiles ObjectScript classes directly into IRIS via MCP tools (not loading from filesystem), these qualifiers are essential:

### Primary Qualifiers

| Qualifier | Effect | Our Use |
|-----------|--------|---------|
| `/noload` | Skips loading test files from `^UnitTestRoot` directory; runs tests already compiled in namespace | **Required** — our tests are compiled via MCP, not loaded from disk |
| `/nodelete` | Retains test classes in memory after execution (default behavior deletes them) | **Required** — we don't want MCP-compiled classes removed |
| `/loadudl` | Loads UDL format files instead of XML during load phase | Not needed with `/noload` |
| `/norecursive` | Don't recurse into subdirectories | Optional — depends on test organization |
| `/debug` | Enables debug mode for test execution | Optional — useful during development |
| `/norun` | Loads but does not execute tests | Not typically needed |

### Combining Qualifiers

Qualifiers are concatenated as a single string:

```objectscript
Do ##class(%UnitTest.Manager).RunTest("", "/noload/nodelete")
```

### Negation Pattern

All boolean qualifiers support negation with the `no` prefix:
- `/load` (default) vs `/noload`
- `/delete` (default) vs `/nodelete`
- `/recursive` (default) vs `/norecursive`

---

## 4. Recommended Setup for iris-execute-mcp-v2

### Automatic Bootstrap Configuration

The project's auto-bootstrap process (or the `execute_unit_tests` MCP tool) should automatically ensure `^UnitTestRoot` is set before running any tests. The recommended approach:

```objectscript
; Set ^UnitTestRoot to empty string — tests are pre-compiled via MCP
Set ^UnitTestRoot = ""

; Execute tests with /noload (skip filesystem loading) and /nodelete (keep classes)
Set tSC = ##class(%UnitTest.Manager).RunTest(testspec, "/noload/nodelete")
```

### Why Empty String + `/noload`

1. **No directory dependency** — eliminates filesystem path errors across environments (Windows, Linux, Docker)
2. **No file sync issues** — tests are compiled directly into the namespace by MCP tools
3. **No cleanup surprises** — `/nodelete` prevents the framework from removing our compiled test classes
4. **Cross-platform** — empty string works identically on all platforms

### Implementation Checklist for Architect

- [ ] The ObjectScript REST handler or utility class that runs unit tests MUST set `^UnitTestRoot = ""` before calling `RunTest()` if it's not already set
- [ ] Always pass `/noload/nodelete` qualifiers when executing via MCP tools
- [ ] The `execute_unit_tests` MCP tool should handle this transparently — the caller should not need to know about `^UnitTestRoot`
- [ ] Consider a setup/initialization classmethod that validates the test environment (global set, namespace correct) before test execution
- [ ] Test classes should follow the `%UnitTest.TestCase` pattern documented in the project's ObjectScript testing rules

### Guard Pattern (Recommended)

```objectscript
/// Ensure ^UnitTestRoot is configured before running tests
ClassMethod EnsureTestEnvironment() As %Status
{
    Set tSC = $$$OK
    Try {
        ; Set ^UnitTestRoot if not already configured
        If '$Data(^UnitTestRoot) {
            Set ^UnitTestRoot = ""
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

---

## 5. Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| `^UnitTestRoot` not set | `RunTest()` fails or returns error | Set `^UnitTestRoot = ""` before execution |
| Missing `/noload` with empty `^UnitTestRoot` | Framework tries to load from empty path | Always pair `^UnitTestRoot = ""` with `/noload` |
| Missing `/nodelete` | Test classes disappear after execution | Add `/nodelete` to preserve MCP-compiled classes |
| Wrong namespace | Tests not found | Ensure `^UnitTestRoot` is set in the correct namespace |
| `$Data(^UnitTestRoot)` check skipped | Intermittent failures in fresh namespaces | Use guard pattern above |

---

## 6. Sources

1. [InterSystems IRIS Unit Test Execution Guide](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GUNITTEST_execute) — Official documentation on RunTest() and qualifiers
2. [%UnitTest.Manager Class Reference](https://docs.intersystems.com/irisforhealthlatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=%25UnitTest.Manager) — Method signatures and parameter details
3. [Test Specification and Qualifiers Reference](https://docs.intersystems.com/supplychain20231/csp/docbook/DocBook.UI.Page.cls?KEY=TUNT_SpecAndQual) — Complete qualifier documentation
4. [Community: Running Tests by Class Name Without Directory](https://community.intersystems.com/post/how-run-test-case-class-name-without-directory-load) — Practical patterns for in-memory test execution
5. [Test Production Execution Options](https://docs.intersystems.com/irisforhealthlatest/csp/docbook/DocBook.UI.Page.cls?KEY=TTEP_TestProd_ExecuteOptions) — Advanced execution options and ^UnitTestRoot configuration
