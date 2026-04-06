# Story 3.5: Setup Class & IPM Module

Status: done

## Story

As an administrator,
I want a one-command IRIS-side setup option and an IPM package for alternative installation,
So that I can complete server setup manually when auto-bootstrap lacks sufficient privileges.

## Acceptance Criteria

1. **Given** the ExecuteMCPv2.Setup class on IRIS
   **When** `Do ##class(ExecuteMCPv2.Setup).Configure()` is called in the %SYS Terminal
   **Then** the /api/executemcp web application is registered with the correct configuration (REST dispatch class, allowed authentication methods, CSP application path)
   **And** the method returns $$$OK on success or a descriptive %Status error on failure

2. **Given** the ipm/module.xml file
   **When** `zpm "install iris-execute-mcp-v2"` is run on IRIS
   **Then** all ExecuteMCPv2 ObjectScript classes are loaded and compiled
   **And** the web application is registered via the Setup.Configure() method
   **And** the installation is a single-command alternative to auto-bootstrap

3. **And** ExecuteMCPv2.Setup.cls compiles successfully on IRIS
   **And** module.xml references all classes in src/ExecuteMCPv2/ and includes the web application configuration

## Tasks / Subtasks

- [ ] Task 1: Create ExecuteMCPv2.Setup class (AC: #1, #3)
  - [ ] 1.1: Create `src/ExecuteMCPv2/Setup.cls` with ClassMethod Configure() As %Status
  - [ ] 1.2: Configure() must:
    - Check if /api/executemcp web application already exists (idempotent)
    - Create or update the web application with properties:
      - Name: /api/executemcp
      - NameSpace: current namespace (or configurable)
      - DispatchClass: ExecuteMCPv2.REST.Dispatch
      - Enabled: 1
      - AutheEnabled: 64 (Password authentication)
      - CSPZENEnabled: 1
      - Resource: (empty or %All)
    - Return $$$OK on success, descriptive %Status on failure
  - [ ] 1.3: Add ClassMethod Uninstall() As %Status for cleanup
  - [ ] 1.4: Compile on IRIS and verify via execute_classmethod

- [ ] Task 2: Create IPM module.xml (AC: #2)
  - [ ] 2.1: Create `ipm/module.xml` referencing all ExecuteMCPv2 classes
  - [ ] 2.2: Include invoke of Setup.Configure() in module lifecycle

- [ ] Task 3: IRIS unit tests (AC: #1, #3)
  - [ ] 3.1: Create `src/ExecuteMCPv2/Tests/SetupTest.cls`
  - [ ] 3.2: Test Configure() creates web app, test idempotent reconfigure, test Uninstall()
  - [ ] 3.3: Compile and run on IRIS

## Dev Notes

### Web Application Registration

Use `%CSP.Application` or the Security.Applications API to create/update the web application:

```objectscript
ClassMethod Configure(pNamespace As %String = "") As %Status
{
    Set tSC = $$$OK
    Try {
        If pNamespace = "" Set pNamespace = $NAMESPACE
        
        ; Must run in %SYS to manage web applications
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        
        Set tAppName = "/api/executemcp"
        Set tExists = ##class(Security.Applications).Exists(tAppName)
        
        If 'tExists {
            ; Create new web application
            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 64  ; Password auth
            Set tProps("CSPZENEnabled") = 1
            Set tSC = ##class(Security.Applications).Create(tAppName, .tProps)
        } Else {
            ; Update existing - ensure dispatch class is correct
            Set tSC = ##class(Security.Applications).Get(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Enabled") = 1
            Set tSC = ##class(Security.Applications).Modify(tAppName, .tProps)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

**CRITICAL:** Must switch to %SYS namespace to use `Security.Applications`. The method should accept an optional namespace parameter (defaults to $NAMESPACE before switching).

### IPM Module Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Export generator="IRIS" version="26">
  <Document name="iris-execute-mcp-v2.ZPM">
    <Module>
      <Name>iris-execute-mcp-v2</Name>
      <Version>0.1.0</Version>
      <Description>IRIS Execute MCP v2 - Custom REST service for MCP tool execution</Description>
      <Packaging>module</Packaging>
      <SourcesRoot>src</SourcesRoot>
      <Resource Name="ExecuteMCPv2.PKG"/>
      <Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>
    </Module>
  </Document>
</Export>
```

### Existing ObjectScript Classes

The module must include all classes in `src/ExecuteMCPv2/`:
- ExecuteMCPv2.Utils
- ExecuteMCPv2.REST.Dispatch
- ExecuteMCPv2.REST.Command
- ExecuteMCPv2.REST.UnitTest
- ExecuteMCPv2.REST.Global
- ExecuteMCPv2.Setup (new)
- ExecuteMCPv2.Tests.* (test classes — may exclude from production module)

### Previous Story Intelligence (Story 3.4)

- 9 ObjectScript classes in src/ExecuteMCPv2/
- Dispatch.cls routes: /command, /classmethod, /tests, /global, /global/list
- All classes extend %Atelier.REST
- 291 TypeScript tests + 52 IRIS unit tests currently passing

### Project Structure Notes

```
src/ExecuteMCPv2/
  Setup.cls             (new — Configure/Uninstall class methods)
  Tests/
    SetupTest.cls       (new — IRIS unit tests)
ipm/
  module.xml            (new — IPM package definition)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 3.5 acceptance criteria]
- [Source: Security.Applications class — IRIS web application management API]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context) — implemented inline

### Debug Log References
- Setup.cls and SetupTest.cls compiled on IRIS (USER namespace), 0 errors
- Configure() verified: creates web app, IsConfigured() returns 1
- Web application /api/executemcp registered pointing to ExecuteMCPv2.REST.Dispatch

### Completion Notes List
- Created Setup.cls with Configure(), Uninstall(), IsConfigured() class methods
- Configure() switches to %SYS, uses Security.Applications.Create/Modify — idempotent
- Web app config: DispatchClass=ExecuteMCPv2.REST.Dispatch, AutheEnabled=64 (Password), CSPZENEnabled=1
- Created IPM module.xml referencing all 10 ObjectScript classes with Invoke of Setup.Configure
- Created SetupTest.cls with 5 IRIS unit tests (create, idempotent, uninstall, uninstall-idempotent, isConfigured)
- OnAfterAllTests restores web app to ensure clean state after tests

### File List
- src/ExecuteMCPv2/Setup.cls (new)
- src/ExecuteMCPv2/Tests/SetupTest.cls (new)
- ipm/module.xml (new)
