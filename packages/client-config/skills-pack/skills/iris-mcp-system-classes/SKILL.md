---
name: iris-mcp-system-classes
description: "Using the IRIS system classes from ObjectScript: what the Config, SYS and Security classes hold and when one answer needs two of them, class queries with fewer columns than the class, deprecated properties that still read but no longer follow the configuration, switching to %SYS and back safely, and counters of one process against the whole instance. Use when code calls Config, SYS or Security classes, switches $NAMESPACE to %SYS, reports system metrics, or fails with CLASS DOES NOT EXIST or NAMESPACE around a namespace switch."
---

# IRIS system classes

Every behavior below was observed on IRIS 2026.2.

## Config, SYS and Security

- `Config.*` classes read and write the instance's configuration file, the settings it starts with. `SYS.*` classes report on the running instance, such as whether a database is mounted. `Security.*` classes hold users, roles, resources and the rest of authorization.
- All three are classes of the `%SYS` namespace. In `USER`, `##class(%Dictionary.CompiledClass).%ExistsId("Config.Databases")` is 0, and calling such a class from outside `%SYS` raises `<CLASS DOES NOT EXIST>`. `%SYS.ProcessQuery`, whose name starts with `%`, exists in `USER` too.
- One answer often needs two of them. For a database, `##class(Config.Databases).Get(name, .props)` gives its `Directory` and how it mounts, but no size and no mounted state. `##class(SYS.Database).%OpenId(directory)` gives `Size` in MB, `Mounted` and `ReadOnly`. Join the two on the directory. `##class(Config.Namespaces).Get(ns, .props)` names a namespace's globals database in `props("Globals")`.
- Read a class before you call it, because the usual method names are often missing. `Config.Namespaces` has no `NamespaceList` method; its `List` class query lists the namespaces.
- A class query often returns fewer columns than the class has properties. The `List` query of `Security.Roles` has no `Resources` column, and its `ListAll` query has one. `Get(name, .props)` returns the properties of one item.
- `Get` on a missing name returns an error status, such as `ERROR #883: Role ... does not exist` from `Security.Roles` and `ERROR #420: Database ... does not exist` from `Config.Databases`.
- The `%All` role grants every permission, yet `Get("%All", .props)` gives it an empty `Resources`. A permission check that walks a role's resources has to treat `%All` as granting everything, and should match the role name exactly, not as part of a longer name.

## Deprecated properties

- A deprecated property can still be read. Look for `[ Deprecated ]` on the property, or query `%Dictionary.CompiledProperty` with `Deprecated = 1`. For `Security.SSLConfigs` that gives `CRLFile`, `Protocols` and `SNIName`.
- It may no longer follow the configuration. `Protocols` still reads through SQL and on the object, but it read empty for each of three TLS configurations whose `TLSMinVersion` and `TLSMaxVersion` were 16 and 32, TLS 1.2 to 1.3. `Get(name, .props)` leaves it out. Use the replacement that the property's comment names.

## Switching to %SYS

```objectscript
ClassMethod DatabaseDirectory(pName As %String, Output pDir As %String) As %Status
{
    Set tSC = $$$OK, pDir = ""
    If pName = "" Quit $$$ERROR($$$GeneralError, "A database name is required")
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Databases).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) Set pDir = $Get(tProps("Directory"))
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- The method checks its input before the switch, keeps the original namespace in a local variable, and restores it right after the system call and first in `Catch`. It returned in the original namespace for a database that exists, for a missing one with `ERROR #420`, and for an empty name.
- `Set $NAMESPACE` is not undone by an error. When a called method switches and then fails, the caller's `Catch` runs in `%SYS`.
- Local variables keep their values across a switch.
- Switching to a namespace that does not exist raises `<NAMESPACE>` and leaves you where you were. `##class(%SYS.Namespace).Exists(name)` checks first.
- Kill a `%SQL.Statement` result of a `%SYS` class query, prepared with `%PrepareClassQuery`, before you switch back. Killed after the switch, it raised `<CLASS DOES NOT EXIST>`. One still open when its method returned raised the error after the method's own `Catch` had finished, so the caller got it. A `%ResultSet` of the same query could be killed after the switch without an error, and so could an object of such a class opened by ID, which could also still be read.
- In a REST handler, avoid `New $NAMESPACE`. The switch then lasts until the method returns, so its `Catch` and its error response run in `%SYS`. Whether the application's own classes exist there depends on package mappings: a mapped package resolved in `%SYS`, while `Ens.Director` did not. A handler that works on one instance can therefore fail on another, so restore the namespace yourself.

## One process or the whole instance

- `##class(%SYS.ProcessQuery).%OpenId($Job)` reports the current process only. Its `CommandsExecuted` and `GlobalReferences` count that process's own work: a loop of 100,000 passes added about 200,000 commands.
- A server process that handles many requests keeps counting across them. One REST worker's `CommandsExecuted` was 3.5 billion, so a handler that reports it describes that worker, not the instance and not the request.
- Instance-wide totals since startup come from `SYS.Stats.Routine.Sample().RtnCommands`, and from `SYS.Stats.Global.Sample()` as `RefLocal + RefPrivate + RefRemote`, run in `%SYS`. The instance's command total was 51 times the worker's, and both totals only grew between samples.
- `SYS.Stats.Routine.Sample()` is declared to return a `SYS.Stats.Global`, but it returns a `SYS.Stats.Routine`, which is the object that has `RtnCommands`.
- A delta does not tell the two kinds apart. Over one short call on a quiet instance, the instance's commands grew by 200,430 and the process's by 200,488. Compare totals instead.

## Related skills

- `iris-mcp-objectscript-gotchas`: `New $NAMESPACE` and `Catch`, and calling `Ens` classes where they do not exist.
- `iris-mcp-objectscript-error-handling`: turning an exception into a `%Status`.
