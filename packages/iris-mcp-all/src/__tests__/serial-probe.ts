/**
 * The probe behind the serial-suite guard in `epic38-gate-guards.test.ts`.
 *
 * Two inert test files (`serial-probe-a.test.ts`, `serial-probe-b.test.ts`) call `holdAndWatch`. It does
 * nothing unless the guard's child run names a marker directory in `MCP_SERIAL_PROBE_DIR`. Then each file
 * holds an `<self>.active` marker for `SERIAL_PROBE_HOLD_MS`, records an `<self>.overlap` marker if it sees the
 * other file's `.active` marker (which can only happen when the two files run at the same time), and leaves a
 * `<self>.held` marker once it has held the full time.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The environment variable that arms the probe: the marker directory the guard created. */
export const SERIAL_PROBE_DIR_VAR = "MCP_SERIAL_PROBE_DIR";

/** How long each probe file holds its marker (long enough for the other file to start meanwhile). */
export const SERIAL_PROBE_HOLD_MS = 2000;

const POLL_MS = 50;

/** Hold this file's marker, watching for the other file's, when the probe is armed; otherwise return at once. */
export async function holdAndWatch(self: "a" | "b", other: "a" | "b"): Promise<void> {
  const dir = process.env[SERIAL_PROBE_DIR_VAR];
  if (!dir) return;

  const mine = path.join(dir, `${self}.active`);
  const theirs = path.join(dir, `${other}.active`);
  writeFileSync(mine, String(process.pid));
  try {
    const deadline = Date.now() + SERIAL_PROBE_HOLD_MS;
    while (Date.now() < deadline) {
      if (existsSync(theirs)) writeFileSync(path.join(dir, `${self}.overlap`), String(process.pid));
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    writeFileSync(path.join(dir, `${self}.held`), String(process.pid));
  } finally {
    rmSync(mine, { force: true });
  }
}
