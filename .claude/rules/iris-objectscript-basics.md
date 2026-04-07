# ObjectScript Basics
## Basics  
   - "namespace" = IRIS namespace  
   - "package" prefix = class prefix  
   - Do not create classes or properties with '%' or '_'  
   - Class parameter names must not contain underscore ('_') characters - use camel case (e.g., "MyParameter") or all caps without underscores (e.g., "MYPARAM" or "MYPARAMETER") instead
   - Method names must not contain underscore ('_') characters; use camel case (e.g., `TestCoreScenario45UNIT001`) and keep any formal test IDs in comments or assertion messages instead of the method name
   - Compile classes using the compile_objectscript_class or compile_objectscript_package MCP tool.

## Abstract Methods in ObjectScript
   - **CRITICAL**: Despite documentation suggesting otherwise, abstract methods MUST have code blocks with curly braces {} - they cannot be truly empty or the class will not compile
   - **CRITICAL**: Abstract methods must return an appropriate value based on their signature:
     - Methods returning objects: Use `Quit $$$NULLOREF` or `Quit ""`
     - Methods returning %Status: Use `Quit $$$OK`
     - Methods returning %String: Use `Quit ""`
     - Methods returning %Boolean: Use `Quit 0`
     - Methods returning %Numeric: Use `Quit 0`
   - Abstract methods are marked with `[ Abstract ]` keyword after the method signature
   - While documentation states abstract methods have no executable code, the compiler requires implementation bodies that return values
   - Subclasses override abstract methods with actual implementations
   - Example pattern:
     ```objectscript
     Method MyAbstractMethod() As %String [ Abstract ]
     {
         Quit ""
     }
     
     Method ProcessData() As %Status [ Abstract ]
     {
         Quit $$$OK
     }
     
     Method CreateObject() As MyClass [ Abstract ]
     {
         Quit $$$NULLOREF
     }
     ```
   - Both instance methods and class methods can be abstract
   - Classes containing abstract methods cannot be instantiated directly
   - Concrete subclasses must implement all inherited abstract methods

## While writting ObjectScript  
   - Return a %Status from methods that produce no return value.  
   - First line: Set tSC = $$$OK  
   - Last line: Quit tSC  
   - Use try/catch for error trapping  
   - Use doc comment banners with HTML/DocBook markup
   - CRITICAL: ObjectScript macro syntax must use triple dollar signs ($$$) not double ($$)
   - If encountering multiple $$ syntax errors in a file, use write_to_file for full replacement rather than multiple replace_in_file operations
   - %DynamicObject properties witih an underscore in the name must have qoutation marks around them because underscore is the concatination operator: Set request."max_results" = 5

## QUIT Statement Restrictions in Try/Catch Blocks
   - **CRITICAL**: QUIT with arguments is NOT allowed within Try/Catch blocks (ERROR #1043)
   - The $QUIT special variable determines if argumented QUIT is required (1) or not (0)
   - **Solutions for methods that must return values:**
     1. Initialize return variable before Try block: `Set result = ""`
     2. Set return value within Try block: `Set result = object`
     3. Use argumentless QUIT in Try/Catch: `Quit` (no arguments)
     4. Return the variable after Try/Catch: `Quit result`
   - **Alternative**: Use RETURN statement instead of QUIT (different semantics)
   - **Pattern Example:**
     ```objectscript
     Method CreateProduct() As Product
     {
         Set result = ""  // Initialize return variable
         Try {
             Set result = ##class(Product).%New()
             // More logic...
             Quit  // Argumentless QUIT
         }
         Catch ex {
             // Error handling...
             Quit  // Argumentless QUIT
         }
         Quit result  // Return the result after Try/Catch
     }
     ```
   - Multiple QUIT statements in a method are allowed, but consistency in argument usage is important
   - This restriction ensures proper exception handling and control flow in error scenarios

## When editing files 
   - When replace_in_file fails to resolve typos or syntax errors, use write_to_file for full file replacement
   - Use full file replacement (write_to_file) when multiple syntax corrections are needed to avoid cascading errors
   - CRITICAL: Always use write_to_file for $ vs $$ macro syntax fixes - never use replace_in_file for these issues

## InterSystems Libraries  
   - Use built-in IRIS classes/packages for performance and maintainability.
   - InterSystems Librarys have packages that begin with %, and also include: HS, Ens, and EnsLib amoung others.

## Naming Conventions  
   - Parameters have "p" prefix (e.g., pItem).  
   - Local variables have "t" prefix (e.g., tIndex).  
   - Class properties are capitalized with no prefix.
   - Class Parameters must be accessed using the # character (e.g., ..#PARAMETERNAME).

## Comments  
   - Semicolon for single-line comments  
   - Class/Method banners must have HTML & DocBook markup
   - Use `///` for method-level doc comments in class definitions; avoid `//`, which is not treated as a comment in ObjectScript classes and can break parsing
   - Reserve `/* ... */` block comments for safe top-of-file banners; avoid placing them immediately around method signatures, as mismatched or misplaced blocks can trigger ERROR #5559 parse failures

## Indentation and Formatting
   - Always indent ObjectScript commands within methods by at least 1 space or tab to avoid compile errors.
   - Ensure each code block is consistently spaced to maintain readability and proper compilation in IRIS.
   - When editing ObjectScript class files, prefer reading the entire file then writing the full content back, rather than partial search-replace, to maintain indentation integrity.

## Python Integration
   - Read documention/IRIS_Embedded_Python_Complete_Manual.md at the start of any session that intends to use Python, if it doesn't exist use Perplexity to search for the latest embedded python documentation.
   - Prefer native ObjectScript for IRIS operations (globals, persistence, SQL, transactions)
   - Use embedded Python only for external library integration (OpenAI, NumPy, ML libraries, document processing)
   - Follow embedded Python patterns: %SYS.Python.Import() for libraries, [Language = python] for methods
   - Use 'import iris' bridge when calling IRIS from Python code
   - Maintain backward compatibility with mock implementations as fallbacks
   - CRITICAL: ##class(%SYS.Python).IsAvailable() does NOT exist. To check for Python, you must first attempt to load it by importing a library (e.g., `do ##class(%SYS.Python).Import("sys")`), and *then* check the status with `##class(%SYS.Python).GetPythonVersion()`. The `GetPythonVersion()` method only detects if Python has *already been loaded*; it does not load Python itself.

## Namespace Switching in REST Handlers
   - **CRITICAL**: Never use `New $NAMESPACE` in REST dispatch handler classes (classes extending `%Atelier.REST` or called from Dispatch UrlMap routes)
   - `New $NAMESPACE` + `Set $NAMESPACE = "%SYS"` makes classes from the original namespace (e.g., `ExecuteMCPv2.Utils`) invisible in catch blocks, causing `<CLASS DOES NOT EXIST>` crashes on any error path
   - **Safe pattern**: Use explicit save/restore with a local variable:
     ```objectscript
     Set tOrigNS = $NAMESPACE
     Set $NAMESPACE = "%SYS"
     ; ... do work in %SYS ...
     Set $NAMESPACE = tOrigNS
     ; ... now safe to call ExecuteMCPv2.Utils, RenderResponseBody, etc.
     ```
   - In catch blocks, ALWAYS restore namespace as the first line: `Set $NAMESPACE = tOrigNS`
   - Do all input validation (Utils.ValidateRequired, Utils.ReadRequestBody) BEFORE switching to %SYS
   - After each system class call (Config.*, Security.*), restore namespace before error handling
   - `Config.Namespaces`, `Config.Databases`, `Config.Map*` classes only exist in %SYS — they require the namespace switch
   - `Security.Users`, `Security.Roles`, `Security.Resources`, `Security.Applications`, `Security.SSLConfigs` also require %SYS
   - For listing operations, prefer `##class(%ResultSet).%New("Config.Namespaces:List")` named queries over non-existent class methods like `Config.Namespaces.NamespaceList()`

## Storage Sections
   - IMPORTANT: Storage sections of ObjectScript classes should NEVER be edited or added.  The compiler will add/maintain these sections of the class based on properties declared in the class and superclasses.

## ObjectScript Compiler
   - Classes should be compiled using the compile_objectscript_class or compile_objectscript_package mcp tool.

## Ensemble Architecture Guidance
- When creating Business Services or Business Operations in Ensemble, ensure method signatures exactly match the InterSystems-defined definitions, for example:
  • OnProcessInput(pInput As %RegisteredObject, Output pOutput As %RegisteredObject, ByRef pHint As %String).
  • OnMessage(pRequest As MyRequestClass, Output pResponse As MyResponseClass).
- Use custom classes extending Ens.Request/Ens.Response to handle data exchange between services and operations.
- Verify the proper IRIS adapter is specified on each Business Service/Operation (e.g., EnsLib.File.InboundAdapter, EnsLib.File.OutboundAdapter).
- Carefully implement synchronous vs. asynchronous flows depending on production requirements.
- Always confirm that the method arguments match the correct data types expected by Ensemble, to avoid signature errors.
- Thoroughly review the relevant built-in Ensemble classes (Ens.BusinessService, Ens.BusinessProcess, Ens.BusinessOperation) for method signatures and best practices before extending them.

## IRIS MCP Debugging Capabilities
- I have DIRECT access to IRIS through MCP server tools for debugging and execution
- Available tools: execute_command, execute_classmethod, get_global, set_global, execute_sql
- Can start/stop IRIS Interoperability Productions using interoperability_production_* tools
- **CRITICAL**: Always specify namespace parameter when using IRIS MCP tools
- **CRITICAL**: execute_classmethod only works with CLASS METHODS (marked ClassMethod), NOT instance methods
- For instance methods, build a classmethod that instances the class and then calls the instance method.
- **CRITICAL**: Do NOT use execute_command for debugging/testing - create unit tests or temporary debug class methods instead
- Self-debugging pattern: Initialize ^ClineDebug = "", capture steps with SET ^ClineDebug = ^ClineDebug _ "step info; ", inspect with get_global
- Can execute ObjectScript commands directly without user intervention
- Can call class methods with parameters and inspect results immediately
- Can run SQL queries directly on IRIS tables for validation
- Use globals for debugging state capture and inspection between method calls
- Always clean up debug globals after debugging sessions
- Namespace specification essential for accessing classes and data

## IRIS Environment Details
- **IRIS is NOT running in Docker** - do not use docker commands
- **Testing**: Use MCP tools (iris-execute-mcp) for execution
- **Direct IRIS access**: Available through MCP servers for real-time testing and debugging

## Research and Knowledge Resources
- Use Perplexity MCP as a reference source when uncertain about ObjectScript syntax, problem-solving approaches, or specification details
- Always research with Perplexity MCP before attempting solutions when knowledge is incomplete
- Consult Perplexity MCP for best practices, error resolution, and technical implementation guidance in ObjectScript and IRIS

## ObjectScript Collection and Object Handling
- CRITICAL: ObjectScript's $listbuild() and $list() functions serialize objects to strings, losing object identity
- When storing objects temporarily, use individual variables (Set obj1 = ..., Set obj2 = ...) rather than lists
- For unit tests, avoid $listbuild() when testing object properties - use direct object assignment instead
- Collection errors like "<INVALID OREF>" often indicate attempts to access serialized objects as if they were still objects
- When debugging collection issues, check for batch processing logic that may be accessing invalid object references

## Debugging and Error Resolution Patterns
- For "<INVALID OREF>" errors in collections: Look for object serialization issues or invalid object references in batch processing code
- For unit test failures with $ISOBJECT(): Check if objects are being stored in lists and losing object identity
- When multiple $ vs $$ syntax errors occur: Always use write_to_file for full replacement rather than multiple replace_in_file operations
- For complex ObjectScript debugging: Simplify architecture by eliminating unnecessary complexity (batch processing, complex collections) in favor of simple, reliable patterns
- Architecture principle: Choose reliability and maintainability over performance optimization when debugging complex issues

## IRIS Vector Search and Embedding Operations
- CRITICAL: Vector operations require exact datatype compatibility between query and stored embeddings
- Common SQL Error -259: "Cannot perform vector operation on vectors of different datatypes" indicates datatype mismatch
- SOLUTION: Use IRIS native embedding generation for query embeddings to match stored embedding types
- Pattern: Create temporary DocumentChunk with same MODEL parameter, use IRIS auto-embedding generation, extract result
- Vector search diagnostic approach: Create comprehensive diagnostic methods to isolate SQL query vs embedding generation issues
- Always use %Library.Embedding datatype for IRIS vector operations, not %Vector datatype
- Test vector operations with simple queries first, then complex semantic searches
- Realistic similarity scores for vector search: High relevance (0.6-0.8), Medium (0.3-0.6), Low (0.2-0.4)

##ObjectScript Debugging Instructions

ObjectScript can be debugged using globals by adding statements to the class:

Add the the following statement to your class file to clear the debug global: SET ^ClineDebug = ""
Each line in your class file where you want to add a debug statement use: SET ^ClineDebug = ^ClineDebug_"The information you want included; "
Execute the portion of the system you are testing, which will collect the debug information in ^ClineDebug
To read the debug information that has been captured while running the code, use the get_global tool to retrieve ^ClineDebug
Other things to keep in mind:

The excute_command tool can only be used with very simple commands. Instead of creating a complex commands, create a helper class method and use the execute_classmethod tool
To debug instance methods, create a temporary class method that calls the instance method. You can use ^ClineDebug within the class method if desired.
Make sure you clean up any temporary classes after you are finished with them.