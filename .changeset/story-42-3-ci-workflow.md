---
"@iris-mcp/shared": patch
---

chore: `deployClasses` and `compileClasses` take an optional list, and `compileClasses` returns the Atelier response (Story 42.3)

- `deployClasses(http, config, version, classes?)` deploys the documents of the map it is given, and `compileClasses(http, config, version, names?)` compiles the names it is given. Both default to the embedded bootstrap classes, so every call that omits them sends the requests it sent before. `compileClasses` now resolves with the Atelier envelope instead of nothing; the bootstrap flow ignores it. CI's seed uses this to deploy the test and fixture classes after the real bootstrap.
- The `lint` script of every package that has one runs `eslint src/ --max-warnings 0`, and the unused `eslint-disable` directive in `cli/governance.ts` is gone (DW-666).

No tool, action, governance key, annotation, description, REST route, ObjectScript class or environment variable is added or changed, and `BOOTSTRAP_VERSION` does not move.
