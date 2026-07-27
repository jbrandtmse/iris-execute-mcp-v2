/**
 * Runtime fake for the `vscode` module, aliased in `vitest.config.ts` so
 * headless tests can drive the REAL `extension.ts` wiring (`activate()` →
 * command/status-bar/provider registration → provide/resolve) without a VS
 * Code host.
 *
 * **Rule #54 — every shape here is one the real VS Code API can genuinely
 * produce**, pinned to the installed `@types/vscode@1.125.0` declarations as
 * the oracle:
 *
 * - `window.showWarningMessage(message, { modal: true }, ...items)` resolves
 *   the chosen item string, or `undefined` when dismissed
 * - `window.showQuickPick(items, { canPickMany: true })` resolves
 *   `T[] | undefined` — `undefined` on cancel, `[]` when confirmed with
 *   nothing checked (the 31-5-3 gesture)
 * - `workspace.getConfiguration(section).get/inspect/update` — `inspect`
 *   returns `undefined` when the key is defined in no scope, and may carry a
 *   value in only one scope (here: `globalValue` only)
 * - `extensions.getExtension(id)` returns `{ isActive, activate(), exports }`
 *   or `undefined`
 * - `lm.registerMcpServerDefinitionProvider(id, provider)` returns a
 *   `Disposable`
 * - `authentication.getSession` resolves `undefined` ONLY for a silent probe
 *   with no scripted session; with `createIfNone`/`forceNewSession` it
 *   REJECTS (the real cancel shape — Epic 31's 31.4 HIGH) unless a test
 *   scripts a session via `mockState.nextSession`
 * - `McpStdioServerDefinition`'s constructor/readonly-`label`/mutable-`env`
 *   shape mirrors the declared class
 * - `ConfigurationTarget`/`StatusBarAlignment` enum values mirror the
 *   declared members
 *
 * Tests manipulate {@link mockState} (reset via {@link resetMockState}) to
 * script the editor's side of every interaction; nothing here fakes a shape
 * the real API cannot return.
 */

export interface MockDisposable {
  dispose(): void;
}

export interface MockStatusBarItem {
  id: string;
  name: string | undefined;
  command: string | undefined;
  text: string;
  tooltip: string | undefined;
  shown: boolean;
  show(): void;
  dispose(): void;
}

export interface MockServerManagerExtension {
  isActive: boolean;
  activate(): Promise<void>;
  exports: unknown;
}

export interface MockMcpProviderRegistration {
  id: string;
  provider: {
    provideMcpServerDefinitions(token: unknown): Promise<unknown[]>;
    resolveMcpServerDefinition(server: unknown, token: unknown): Promise<unknown>;
  };
}

export interface MockState {
  /** The Server Manager extension `extensions.getExtension` returns (undefined = absent). */
  serverManager: MockServerManagerExtension | undefined;
  /** Backing store for `workspace.getConfiguration(section).get/inspect/update`, keyed `"<section>.<key>"`. */
  configStore: Map<string, unknown>;
  /** Every `update(key, value, target)` the extension made. */
  configUpdates: { key: string; value: unknown; target: number | undefined }[];
  /** Non-modal `showWarningMessage` calls (the extension's user-facing warnings). */
  warnings: string[];
  /** `showInformationMessage` calls. */
  infos: string[];
  /** Output-channel lines. */
  outputLines: string[];
  /** What the modal confirm resolves — an item string ("Expose All") or undefined (dismissed). */
  modalConfirmResponse: string | undefined;
  /** Scripted `showQuickPick` responder. */
  quickPickResponder: (items: unknown[]) => unknown;
  /** Recorded `authentication.getSession` argument tuples. */
  getSessionCalls: unknown[][];
  /** Scripted session for `authentication.getSession` to resolve (undefined = none scripted). */
  nextSession: unknown;
  /** Commands registered via `commands.registerCommand`. */
  commands: Map<string, (...args: unknown[]) => unknown>;
  /** MCP providers registered via `lm.registerMcpServerDefinitionProvider`. */
  mcpProviders: MockMcpProviderRegistration[];
  /** Status bar items created via `window.createStatusBarItem`. */
  statusBarItems: MockStatusBarItem[];
  /** `workspace.onDidChangeConfiguration` listeners. */
  configChangeListeners: ((event: { affectsConfiguration(section: string): boolean }) => void)[];
}

export const mockState: MockState = {
  serverManager: undefined,
  configStore: new Map(),
  configUpdates: [],
  warnings: [],
  infos: [],
  outputLines: [],
  modalConfirmResponse: undefined,
  quickPickResponder: () => undefined,
  getSessionCalls: [],
  nextSession: undefined,
  commands: new Map(),
  mcpProviders: [],
  statusBarItems: [],
  configChangeListeners: [],
};

/** Restore every piece of scripted editor state between tests. */
export function resetMockState(): void {
  mockState.serverManager = undefined;
  mockState.configStore = new Map();
  mockState.configUpdates = [];
  mockState.warnings = [];
  mockState.infos = [];
  mockState.outputLines = [];
  mockState.modalConfirmResponse = undefined;
  mockState.quickPickResponder = () => undefined;
  mockState.getSessionCalls = [];
  mockState.nextSession = undefined;
  mockState.commands = new Map();
  mockState.mcpProviders = [];
  mockState.statusBarItems = [];
  mockState.configChangeListeners = [];
}

function disposable(): MockDisposable {
  return { dispose: () => undefined };
}

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (line: string) => void mockState.outputLines.push(line),
    dispose: () => undefined,
  }),

  showWarningMessage: (message: string, ...rest: unknown[]): Promise<string | undefined> => {
    const options = rest.find(
      (arg): arg is { modal?: boolean } => typeof arg === "object" && arg !== null,
    );
    if (options?.modal === true) {
      // The modal confirm form resolves the CHOSEN item, or undefined when
      // dismissed — the real API's exact shapes for the 31-5-3 confirmation.
      const items = rest.filter((arg): arg is string => typeof arg === "string");
      const choice = mockState.modalConfirmResponse;
      return Promise.resolve(choice !== undefined && items.includes(choice) ? choice : undefined);
    }
    mockState.warnings.push(message);
    return Promise.resolve(undefined);
  },

  showInformationMessage: (message: string): Promise<undefined> => {
    mockState.infos.push(message);
    return Promise.resolve(undefined);
  },

  showQuickPick: (items: unknown[], _options?: unknown): Promise<unknown> =>
    Promise.resolve(mockState.quickPickResponder(items)),

  createStatusBarItem: (id: string, _alignment?: number): MockStatusBarItem => {
    const item: MockStatusBarItem = {
      id,
      name: undefined,
      command: undefined,
      text: "",
      tooltip: undefined,
      shown: false,
      show() {
        item.shown = true;
      },
      dispose() {
        item.shown = false;
      },
    };
    mockState.statusBarItems.push(item);
    return item;
  },
};

export const workspace = {
  getConfiguration: (section: string) => ({
    get: <T>(key: string, defaultValue: T): T => {
      const fullKey = `${section}.${key}`;
      return mockState.configStore.has(fullKey)
        ? (mockState.configStore.get(fullKey) as T)
        : defaultValue;
    },
    inspect: <T>(key: string): { globalValue?: T; workspaceValue?: T } | undefined => {
      const fullKey = `${section}.${key}`;
      // The real return shape carries one field per scope the value is
      // defined in; a user-settings-only value yields `{ globalValue }` and a
      // nowhere-defined value yields `undefined` — both real shapes.
      return mockState.configStore.has(fullKey)
        ? { globalValue: mockState.configStore.get(fullKey) as T }
        : undefined;
    },
    update: (key: string, value: unknown, target?: number): Promise<void> => {
      mockState.configUpdates.push({ key, value, target });
      mockState.configStore.set(`${section}.${key}`, value);
      return Promise.resolve();
    },
  }),

  onDidChangeConfiguration: (
    listener: (event: { affectsConfiguration(section: string): boolean }) => void,
  ): MockDisposable => {
    mockState.configChangeListeners.push(listener);
    return disposable();
  },
};

export const commands = {
  registerCommand: (id: string, handler: (...args: unknown[]) => unknown): MockDisposable => {
    mockState.commands.set(id, handler);
    return disposable();
  },
};

export const extensions = {
  getExtension: (id: string): MockServerManagerExtension | undefined =>
    id === "intersystems-community.servermanager" ? mockState.serverManager : undefined,
};

export const authentication = {
  getSession: (...args: unknown[]): Promise<unknown> => {
    mockState.getSessionCalls.push(args);
    // Rule #54: the real API resolves `undefined` only for a SILENT probe
    // with no existing session. With `createIfNone`/`forceNewSession` it
    // either resolves a session or REJECTS (user cancel) — it never resolves
    // undefined (Epic 31's 31.4 HIGH pinned exactly that shape). A fake that
    // resolves undefined for the prompting shapes would green-light a code
    // path the real API can never produce, so this mock rejects there until
    // a test scripts a session via `mockState.nextSession`.
    const options = args[2] as { createIfNone?: boolean; forceNewSession?: boolean } | undefined;
    if (mockState.nextSession !== undefined) {
      return Promise.resolve(mockState.nextSession);
    }
    if (options?.createIfNone === true || options?.forceNewSession === true) {
      return Promise.reject(new Error("User did not consent to login."));
    }
    return Promise.resolve(undefined);
  },
};

export const lm = {
  registerMcpServerDefinitionProvider: (
    id: string,
    provider: MockMcpProviderRegistration["provider"],
  ): MockDisposable => {
    mockState.mcpProviders.push({ id, provider });
    return disposable();
  },
};

/** Mirrors the declared `vscode.McpStdioServerDefinition` (readonly `label`, mutable `env`). */
export class McpStdioServerDefinition {
  readonly label: string;
  command: string;
  args: string[];
  env: Record<string, string | number | null>;
  version?: string;

  constructor(
    label: string,
    command: string,
    args: string[] = [],
    env: Record<string, string | number | null> = {},
    version?: string,
  ) {
    this.label = label;
    this.command = command;
    this.args = args;
    this.env = env;
    this.version = version;
  }
}

/** Mirrors the declared `vscode.ConfigurationTarget` enum members. */
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

/** Mirrors the declared `vscode.StatusBarAlignment` enum members. */
export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;
