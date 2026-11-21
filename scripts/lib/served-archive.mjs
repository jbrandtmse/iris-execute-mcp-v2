// The two outside calls of the served-archive leg of `scripts/ci-ipm-archive.mjs` (Story 42.8, DW-694): a read-only `git` in the
// repository, and one unauthenticated public GET of GitHub's archive of the commit under test. Importing this module runs nothing.
//
// CONTRACT
//   - `git(args)` runs `git <args>` with `cwd` as the working directory and the given environment, and returns
//     `{ status, stdout: Buffer, stderr: string, error }` (the shape of `spawnSync` with no encoding). The proof issues exactly the verbs
//     in {@link GIT_VERBS}: `ls-files` and `archive`, both of which only read. Nothing here commits, tags, fetches or pushes.
//   - `fetch(url)` is `globalThis.fetch` with a timeout: a GET with no credentials, so the leg reads no secret and runs on a pull
//     request from a fork. It is called from the runner host, never from a container.
//   - `fetchWithRetry(url, deps)` makes up to three attempts in all (waits of {@link FETCH_RETRY_DELAYS_MS} between them, taken from
//     `deps.sleep`, so a test passes zero waits) and gives up with the last attempt's status or error text.

import { spawnSync } from 'node:child_process';

/** The git verbs the served-archive leg issues. */
export const GIT_VERBS = Object.freeze(['ls-files', 'archive']);

/** The most bytes of output a git call may return: the repository's `git archive` is about 14 MB as tar.gz. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/** The longest the fetch of GitHub's archive may take. */
export const FETCH_TIMEOUT_MS = 180_000;

/** The waits between the attempts of the archive GET: three attempts in all, one wait after the first failure and a longer one after the second. */
export const FETCH_RETRY_DELAYS_MS = Object.freeze([2_000, 5_000]);

/**
 * GET `url` until it answers 200 or the attempts run out: any other status and any network error is retried after the next delay of
 * `retryDelaysMs`. After the last attempt the result names what the last attempt got; it never substitutes another source.
 *
 * @param {string} url
 * @param {{ fetch: (url: string) => Promise<Response>, sleep: (ms: number) => Promise<void>, retryDelaysMs: readonly number[] }} deps
 * @returns {Promise<{ bytes: Buffer } | { failure: string }>} `failure` is the status or the error text of the last attempt.
 */
export async function fetchWithRetry(url, deps) {
  const attempts = deps.retryDelaysMs.length + 1;
  let failure = 'no attempt was made';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await deps.fetch(url);
      if (response.status === 200) return { bytes: Buffer.from(await response.arrayBuffer()) };
      failure = String(response.status);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await deps.sleep(deps.retryDelaysMs[attempt - 1]);
  }
  return { failure };
}

/**
 * @param {{ env: Record<string, string | undefined>, cwd: string }} options
 * @returns {{
 *   git: (args: readonly string[]) => { status: number | null, stdout: Buffer, stderr: string, error?: Error },
 *   fetch: (url: string) => Promise<Response>,
 *   sleep: (ms: number) => Promise<void>,
 *   retryDelaysMs: readonly number[],
 * }}
 */
export function defaultServedDeps({ env, cwd }) {
  return {
    git: (args) => {
      if (!GIT_VERBS.includes(args[0])) throw new Error(`refusing the git verb ${JSON.stringify(args[0])}: the served-archive leg issues only ${GIT_VERBS.join(', ')}.`);
      const result = spawnSync('git', args, { cwd, env, maxBuffer: GIT_MAX_BUFFER });
      return {
        status: result.status,
        stdout: result.stdout ?? Buffer.alloc(0),
        stderr: result.stderr?.toString('utf8') ?? '',
        error: result.error,
      };
    },
    fetch: (url) => globalThis.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryDelaysMs: FETCH_RETRY_DELAYS_MS,
  };
}
