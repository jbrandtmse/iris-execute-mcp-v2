// A file-backed fake of the `@napi-rs/keyring` 1.3.0 API, for tests that run a real process which would otherwise reach the OS keychain.
//
// USE
//   It is never imported directly by a test or by product code. `fake-keyring-preload.mjs` makes every resolution of
//   `@napi-rs/keyring` in a process load THIS module instead (see that file for the `NODE_OPTIONS` form).
//
// CONTRACT
//   The surface is the synchronous part of the installed `index.d.ts` that this repo calls:
//     `class Entry(service, username)` with `setPassword(password): void`, `getPassword(): string | null`,
//     `deleteCredential(): boolean` and `deletePassword(): boolean`, and `findCredentials(service, target?)`
//     returning `{ account, password }[]`.
//   The store is the JSON file named by FAKE_KEYRING_FILE: `{ "<service>": { "<account>": "<password>" } }`. It is read
//   from disk on every call and written on every change, so two processes (a `iris-mcp-credentials set` and a server)
//   see one store. A missing file is an empty store. With FAKE_KEYRING_FILE unset every call throws: the fake never
//   falls back to a real keychain and never keeps secrets in memory only.
//   FAKE_KEYRING_UNAVAILABLE=1 makes the import itself throw, the shape of a host where the native module cannot load.
//   `getPassword` and `deleteCredential` of an absent entry answer `null` and `false`.
//
//   `FAKE_KEYRING_API` lists the method names the fake implements; a unit test compares them with the installed
//   `index.d.ts` text, so a rename in a new `@napi-rs/keyring` fails that test instead of passing silently.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.FAKE_KEYRING_UNAVAILABLE === '1') {
  throw new Error('fake @napi-rs/keyring: unavailable (FAKE_KEYRING_UNAVAILABLE=1)');
}

/** The class and function names this fake implements, as the installed `index.d.ts` declares them. */
export const FAKE_KEYRING_API = {
  entryMethods: ['setPassword', 'getPassword', 'deleteCredential', 'deletePassword'],
  functions: ['findCredentials'],
};

function storeFile() {
  const file = process.env.FAKE_KEYRING_FILE;
  if (file === undefined || file === '') {
    throw new Error('fake @napi-rs/keyring: FAKE_KEYRING_FILE is not set, so there is no store to use');
  }
  return file;
}

function readStore() {
  const file = storeFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeStore(store) {
  const file = storeFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store), 'utf8');
}

export class Entry {
  constructor(service, username) {
    this.service = service;
    this.username = username;
  }

  setPassword(password) {
    const store = readStore();
    store[this.service] = { ...store[this.service], [this.username]: password };
    writeStore(store);
  }

  getPassword() {
    const value = readStore()[this.service]?.[this.username];
    return typeof value === 'string' ? value : null;
  }

  deleteCredential() {
    const store = readStore();
    if (store[this.service]?.[this.username] === undefined) return false;
    delete store[this.service][this.username];
    writeStore(store);
    return true;
  }

  deletePassword() {
    return this.deleteCredential();
  }
}

export function findCredentials(service) {
  const accounts = readStore()[service] ?? {};
  return Object.entries(accounts).map(([account, password]) => ({ account, password }));
}
