---
name: iris-mcp-interoperability
description: "Writing IRIS interoperability (Ensemble) components in ObjectScript: business service, process and operation classes and their method signatures, Ens.Request and Ens.Response messages, adapters, settings and message maps, synchronous and asynchronous sends, and why the production class XData, not the configuration tables, defines a production. Use when creating or editing a business host, a message class or a production class, or when a host does not compile, a request is not handled, a setting does not appear, or a configuration change does not last."
---

# Interoperability components

Every behavior below was observed on IRIS 2026.2, by compiling business hosts or by reading the IRIS classes they extend, without running a production.

## Messages

- A request class extends `Ens.Request`, and a response class extends `Ens.Response`. Both are persistent. The send methods declare their request as a `%Library.Persistent`, except a business process's `SendRequestAsync`, which declares an `Ens.Request`.
- A message class derived from `Ens.MessageBody`, as `Ens.Request` and `Ens.Response` are, keeps its data in `^Ens.MessageBodyD`: `Ens.MessageBody`, `Ens.StringRequest` and `Ens.StringResponse` all compile to it. Other message classes keep their own, such as `Ens.StreamContainer` in `^Ens.StreamContainerD`. Leave the storage of a message class to the compiler.
- `Parameter RESPONSECLASSNAME` on a request class names its response class, and `NewResponse(.tResponse)` creates one. Without it, `NewResponse` returns `ERROR <Ens>ErrGeneral: Ens.StringRequest has no value for parameter RESPONSECLASSNAME`.
- `Ens.StringRequest` and `Ens.StringResponse` each carry one `StringValue` property, enough for a first test of a host.

## Business operations

```objectscript
Class MyApp.Ops.FileWriter Extends Ens.BusinessOperation
{

Parameter ADAPTER = "EnsLib.File.OutboundAdapter";

Parameter SETTINGS = "Prefix:Basic,-ThrottleDelay";

Property Prefix As %String [ InitialExpression = "out" ];

Method Write(pRequest As Ens.StringRequest, Output pResponse As Ens.StringResponse) As %Status
{
    Set tSC = ..Adapter.PutString(..Prefix_".txt", pRequest.StringValue)
    If $$$ISERR(tSC) Quit tSC
    Set pResponse = ##class(Ens.StringResponse).%New()
    Set pResponse.StringValue = "written"
    $$$LOGINFO("wrote "_$Length(pRequest.StringValue)_" characters")
    Quit $$$OK
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="Ens.StringRequest">
    <Method>Write</Method>
  </MapItem>
</MapItems>
}

}
```

- `Parameter ADAPTER` names the adapter class, and `..Adapter` is its instance. `EnsLib.File.OutboundAdapter` offers `PutString(filename, data)`, `PutLine` and `PutStream`. A misspelled adapter class still compiles.
- `XData MessageMap` sends each request type to a method. The compiler turns the map into `If pRequest.%IsA(...)` tests in map order, so the first match wins: list a subclass before its superclass. A request that matches no item goes to `OnMessage`, whose default returns an error.
- A map that names a missing method fails the compile with `Method Missing referenced in MessageMap does not exist`. The compiler does not check that the method's argument type matches the map's message type.
- A handler, like `Write` above, may type its arguments with the message classes, and so may an override of `OnMessage`. The response is an `Output` argument: create it in the method.
- A transaction that a handler leaves open is committed after it returns, with a warning in the event log.
- `Parameter INVOCATION` is `"Queue"` unless you set `"InProc"`.
- The log macros `$$$LOGINFO`, `$$$LOGWARNING`, `$$$LOGERROR` and `$$$TRACE` work in a business host without an `Include`. Any other class needs `Include Ensemble`, or the compile fails with `MPP5610 : Referenced macro not defined: 'LOGINFO'`.

## Settings

- `Parameter SETTINGS` lists the properties a production can set, each as `Name:Category`. A host's settings are its own list plus every superclass's list. Above, `Prefix:Basic` adds `Prefix` under Basic Settings, and `-ThrottleDelay` hides an inherited setting, leaving `Prefix` and 14 inherited ones.
- The adapter's settings, such as `FilePath`, come from the adapter class's own list, not from the host's.

## Business services

- A service overrides `OnProcessInput(pInput As %RegisteredObject, Output pOutput As %RegisteredObject, ByRef pHint As %String) As %Status`. A narrower type for `pInput`, such as `%Stream.Object`, compiles.
- With an inbound adapter, the adapter calls the service with what it read. `EnsLib.File.InboundAdapter` passes a file stream, with its file name in `pInput.Attributes("Filename")`.
- `..SendRequestSync(target, tRequest, .tResponse, timeout)` waits for the response, and `..SendRequestAsync(target, tRequest)` does not. The target is the name of a production item, and a name the running production does not know returns an error status.
- The comment on `OnProcessInput` says not to call the send methods from outside it, for example from a CSP page. From there, `##class(Ens.Director).CreateBusinessService(name, .tService)` returns a service to call `ProcessInput` on, or an error status when the production does not know the name, the item is disabled or the production is quiescent.

## Business processes

- A process overrides `OnRequest(request As %Library.Persistent, Output response As %Library.Persistent) As %Status`. Typed arguments compile here too.
- `..SendRequestAsync(target, tRequest, 1, "key")` asks for a response and returns without waiting. The response arrives in `OnResponse(request, .response, callrequest, callresponse, pCompletionKey)`, with the completion key you passed. The default `OnResponse` returns an error, so implement it whenever you ask for a response. `OnComplete` runs when every response is in or the wait has timed out.
- A process that calls another process with `SendRequestSync` can deadlock when both share the production's actor pool, as the IRIS comment on that method warns. Send asynchronously and handle the answer in `OnResponse`, or give the called process a pool of its own.

## The production class defines the production

- A production is a class that extends `Ens.Production`. Its `XData ProductionDefinition` lists the items and their settings.
- Compiling that class deletes the production's row in the configuration tables and loads it again from the XData. A change made only in the tables, such as `Ens_Config.Item`, is lost at the next compile.
- `##class(Ens.Config.Production).LoadFromClass(name)` does the same reload. Call it before `%OpenId(name)` in code that edits a production, so the code starts from what the class holds.
- `SaveToClass()` writes the XData back into the class and saves the class definition, but does not compile it. Until a compile or `LoadFromClass`, a query of the tables does not see an item that was only saved to the class.
- The item index covers the production and the name together and is not unique. Find an item through its production, for example with `FindItemByConfigName`, not by its name alone.
- `##class(Ens.Director).UpdateProduction()` applies a changed configuration to the running production.

## Related skills

- `iris-mcp-objectscript-error-handling`: the `%Status` values that every host method returns.
- `iris-mcp-objectscript-gotchas`: why `Ens` classes are missing in `%SYS` and in some other namespaces.
