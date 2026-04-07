# Epic Development Cycle

Execute the BMAD Method development implementation cycle for epics and stories using Agent Teams with spawn-on-demand coordination.

**Usage:** `/epic-cycle <epic-range> [story]`
- `/epic-cycle 1` — Run all stories in Epic 1
- `/epic-cycle 1-3` — Run Epics 1 through 3
- `/epic-cycle 2 3` — Run only Story 3 of Epic 2

Parse the argument to determine the epic range and optional story filter. If no argument is provided, ask the user which epic(s) to run.

---

## Source Documents

Read these files at the start of every run:
- `_bmad-output/planning-artifacts/epics.md` — Epic and story definitions (authoritative story list)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Current sprint status (may contain additional stories)
- `_bmad-output/implementation-artifacts/deferred-work.md` — Centralized deferred items (if exists)

Build the story list for each epic from **both** `epics.md` and `sprint-status.yaml`. Sprint-status may contain cleanup stories (X.0), hotfixes, or stories not in epics.md.

---

## Permission Mode

**All agents must be spawned with `mode: "bypassPermissions"`** — this is YOLO mode. Agents must not prompt for file edits, bash commands, or tool permissions.

---

## Pipeline Per Epic

### Step 0: Sprint Planning (Lead — Pipeline Gate)

Execute `/bmad-sprint-planning` directly via the `Skill` tool (NOT via an agent).
- Ensures `sprint-status.yaml` is current and all stories are tracked.
- If sprint planning surfaces issues, pause and inform the user before proceeding.
- Log sprint planning completion.

### Step 0.5: Retrospective Review & Story X.0 Creation (Lead — Mandatory Gate)

After sprint planning and before building the story list:

1. **Calculate previous epic number** — if processing Epic N, look for Epic N-1's retrospective.
2. **Search for the retrospective file**: `_bmad-output/implementation-artifacts/epic-{N-1}-retro-*.md`
3. **If a retrospective exists**, read it and extract:
   - All action items (with status)
   - All deferred review findings from that epic's stories
   - Any preparation tasks recommended for the current epic
4. **Also read `_bmad-output/implementation-artifacts/deferred-work.md`** (if it exists).
5. **Triage every item** into: **Include in Story X.0**, **Explicitly defer with rationale**, or **Drop**.
6. **Create Story X.0** by executing `/bmad-create-story` via the `Skill` tool with args: `"Story {N}.0: Epic {N-1} Deferred Cleanup"`. The story file should include the full triage table.
7. **If no previous retrospective exists** (e.g., Epic 1), log that and skip Story X.0.

### Steps 1-4: Per Story Loop

For each story in order (including X.0 if created):

#### Step 1: Create Story (Lead — Pipeline Gate)
Execute `/bmad-create-story` directly via the `Skill` tool.
- **Capture the story file path** from the skill output.
- Do NOT delegate this to an agent.

#### Step 2: Develop Story (Agent)
Spawn a developer agent with a **unique name** `dev-{epic}-{story}` (e.g., `dev-2-3`).

Agent spawn prompt must include:
```
You are a developer agent. Your task is to implement a story using the BMAD development workflow.

**Your task:** Use the `Skill` tool to invoke `/bmad-dev-story` with the story file: {story_file_path}

**CRITICAL — Single-Task Agent:**
- Execute the workflow using the `Skill` tool to invoke `/bmad-dev-story`.
- When done, send a completion message to the lead including:
  - All files created or modified (full paths)
  - Key decisions made
  - Any issues encountered and how they were resolved
- After sending the completion message, STOP completely.
- Do NOT call TaskList, do NOT look for more work.
- Approve any shutdown request immediately.
- Do NOT use TaskList, TaskCreate, or TaskUpdate.
- If you encounter ambiguous requirements or need user input, send a message to the lead describing the issue clearly. Do NOT proceed until the lead responds.
```

- Wait for the agent's completion message.
- **Capture the file list** from the completion message.
- Send `shutdown_request` and **wait for shutdown approval** before proceeding.

#### Step 2.5: Live Verification (Lead — when story modifies ObjectScript)

**Skip this step if the story does not create or modify ObjectScript `.cls` files.**

When the story includes ObjectScript changes, the lead performs live verification before code review:

1. **Deploy to IRIS:**
   ```
   iris.doc.load path="src/ExecuteMCPv2/**/*.cls" compile=true namespace=HSCUSTOM
   ```
   If `iris.doc.load` does not correctly update classes (e.g., "up-to-date" without recompiling), delete and re-upload via the Atelier API, then force compile with `flags=ck`.

2. **Verify each new or modified REST endpoint:**
   - For **list** endpoints: call via curl or MCP tool, verify JSON response has correct structure (array of objects with expected fields, no HTTP 500)
   - For **manage** endpoints: call with a missing required parameter, verify a clean error response (not HTTP 500 or non-JSON)
   - For **security-sensitive** endpoints: verify passwords/secrets are NOT in the response

3. **If issues are found:**
   - Fix the ObjectScript `.cls` file **on disk** (never edit directly on IRIS)
   - Redeploy to IRIS and retest
   - Add fixed files to the file list for code review
   - Document what was found and fixed

4. **If all endpoints pass:** proceed to code review

**Why this step exists:** Two consecutive epics (3 and 4) shipped stories with passing unit tests but broken live endpoints. Mocked HTTP tests cannot catch wrong IRIS API usage, namespace switching issues, or SQL column name mismatches. This step catches those issues before code review.

#### Step 3: Code Review (Agent)
Spawn a code reviewer agent with a **unique name** `cr-{epic}-{story}` (e.g., `cr-2-3`).

Agent spawn prompt must include:
```
You are a code review agent. Your task is to review code changes from a story implementation.

**Your task:** Use the `Skill` tool to invoke `/bmad-code-review` for the following files modified by the developer:
{file_list_from_developer}

Story file for context: {story_file_path}

**CRITICAL — Single-Task Agent:**
- Execute the review using the `Skill` tool to invoke `/bmad-code-review`.
- Automatically resolve all HIGH and MEDIUM severity issues using your best judgment and BMAD guidance.
- Log any deferred findings to `_bmad-output/implementation-artifacts/deferred-work.md`.
- When done, send a completion message to the lead including:
  - Summary of findings by severity
  - Issues auto-resolved and how
  - Any items deferred to deferred-work.md
  - Final list of all files modified (full paths), including any files changed during review fixes
- After sending the completion message, STOP completely.
- Do NOT call TaskList, do NOT look for more work.
- Approve any shutdown request immediately.
- Do NOT use TaskList, TaskCreate, or TaskUpdate.
- If you encounter ambiguous requirements or need user input, send a message to the lead describing the issue clearly. Do NOT proceed until the lead responds.
```

- Wait for the agent's completion message.
- Send `shutdown_request` and **wait for shutdown approval** before proceeding.

#### Step 4: Commit & Push (Lead)

**Submodule commit order is critical:**

1. Check submodule status:
   ```
   git -C src/MA status --short
   git -C src/MALIB status --short
   ```
2. If submodule has changes, commit and push inside the submodule first:
   ```
   git -C src/MA add . && git -C src/MA commit -m "feat(story-X.Y): <description>" && git -C src/MA push
   ```
3. Then commit and push in the parent repo, staging submodule pointers:
   ```
   git add src/MA src/MALIB <other changed files>
   git commit -m "feat(story-X.Y): <description>"
   git push
   ```

#### Step 4.5: Log Completion (Lead)

Write a brief log entry to `_bmad-output/implementation-artifacts/epic-cycle-log.md`:
- Story ID/name
- Files touched
- Key design decisions
- Issues auto-resolved vs. those requiring user input

### Step 5: Epic Completion & Retrospective (Lead — User Decision Point)

After all stories in an epic are complete:

1. Announce: **"Epic X is complete. Would you like to run a retrospective before moving to the next epic? (yes/no)"**
2. **Wait for the user's response.** Do NOT proceed automatically.
3. If **yes**: Execute `/bmad-retrospective` directly via the `Skill` tool. Wait for completion.
4. If **no**: Log that the retrospective was skipped. Continue to next epic.

---

## Handling Clarifications

When an agent sends a clarification request (NOT a completion message):

1. **Do NOT shut down the agent** — it is waiting for a response.
2. Surface the question to the user with Story ID and context.
3. Wait for the user's answer.
4. Relay the answer back to the agent via `SendMessage`.
5. The agent resumes and eventually sends a completion message.
6. Proceed with normal shutdown only after receiving the completion message.

---

## Anti-Patterns (Do NOT Use)

- **TaskCreate/TaskList/TaskUpdate** — Agents self-schedule regardless of constraints
- **Persistent agents between tasks** — Always shut down after each task
- **Generic agent names** — Always use unique names like `dev-2-3`, `cr-2-3`
- **Spawn-then-message** — Embed task in spawn prompt, don't rely on SendMessage for initial dispatch
- **Spawning before shutdown confirms** — Wait for shutdown approval before spawning next agent
- **Inline skill execution** — Always use the `Skill` tool to invoke BMAD skills
- **Parent-before-submodule push** — Always commit/push submodules first
- **Normalizing known test failures** — Fix or formally defer immediately
- **Skipping retrospective review** — Story X.0 creation is mandatory (documents triage even if all items deferred)
- **Reading only epics.md** — Build story list from both epics.md and sprint-status.yaml

---

## Resume Support

If restarting mid-epic, check `sprint-status.yaml` and `epic-cycle-log.md` for current state. Skip completed stories and resume from the last incomplete step.

---

## When to Pause for User Input

Only pause within the pipeline if:
- Acceptance criteria or requirements are ambiguous
- Multiple reasonable design options exist and user preference matters
- Proceeding would risk breaking important constraints (security, compliance, performance, interoperability)
- Sprint planning surfaces issues
- An agent sends a clarification request
