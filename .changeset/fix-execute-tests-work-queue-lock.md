---
"@iris-mcp/dev": patch
---

fix: `iris_execute_tests` no longer reports 0 tests when IRIS's work queue is briefly busy (ERROR #7808); it polls again

- While a test run is in progress, the tool polls Atelier's `/work/{id}` endpoint. IRIS answers that poll with `ERROR #7808: Unable to obtain group '…' command lock` when the running job holds the work manager's command lock past the manager's own 5-second lock timeout. Nothing is drained by such a poll, so no result is lost. Before, the tool reported the error with a total of 0; now it waits one poll interval and polls again, up to 12 times in a row (a successful poll resets the count), within the call's time limit. Any other poll error is reported as before.
