// A preload that routes every `@napi-rs/keyring` import in a process to `fake-keyring.mjs`, so a real built process
// (a server, `iris-mcp-credentials`) uses a file-backed keychain and never the developer's OS keychain.
//
// USE
//   NODE_OPTIONS="--import=<file URL of this file>" FAKE_KEYRING_FILE=<scratch json> <command>
//   Append to any existing NODE_OPTIONS; on Windows the path must be a `file://` URL. Every child process that
//   inherits NODE_OPTIONS gets the fake too.
//
// CONTRACT
//   `module.registerHooks` (Node >= 22.15; `module.register` is deprecated on Node 26) installs a synchronous resolve hook:
//   the bare specifier `@napi-rs/keyring` resolves to `fake-keyring.mjs` for both `import` and `require`, and every
//   other specifier is passed through untouched. The hook is in-thread, so no loader thread or `--experimental-*` flag
//   is involved. Nothing here runs unless the module is loaded; no product code imports it.

import { registerHooks } from 'node:module';

const FAKE_URL = new URL('./fake-keyring.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@napi-rs/keyring') return { url: FAKE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
