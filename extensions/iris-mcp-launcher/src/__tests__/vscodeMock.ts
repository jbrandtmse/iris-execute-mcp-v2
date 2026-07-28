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
 *   returns `undefined` when the key is defined in no scope and carries one
 *   field per scope it IS defined in (`globalValue` from `configStore`,
 *   `workspaceValue` from `configWorkspaceStore`); the merged `get` reads the
 *   workspace value first (the real precedence)
 * - `extensions.getExtension(id)` returns `{ isActive, activate(), exports }`
 *   or `undefined`
 * - `window.showOpenDialog({ canSelectFiles: true })` resolves `Uri[] | undefined`
 *   — an array of `{ fsPath }` Uris when a file is chosen, `undefined` when
 *   dismissed (scripted via `mockState.openDialogResponse`)
 * - `window.showInputBox(options)` resolves `string | undefined` — the typed
 *   string, or `undefined` when dismissed (scripted via
 *   `mockState.inputBoxResponder`; the DEFAULT is the dismissed shape, a real
 *   outcome of every input box)
 * - `window.createWebviewPanel(viewType, title, column, options)` returns a
 *   panel whose `webview.html` is settable, whose
 *   `webview.onDidReceiveMessage`/`onDidDispose` register listeners, and whose
 *   `reveal()` is callable — the exact members `extension.ts`'s governance
 *   panel adapter touches (Story 32.2). Recorded in `mockState.webviewPanels`.
 * - `ViewColumn` enum members mirror the declared values (`One` = 1)
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

/**
 * A recorded `window.createWebviewPanel` call. The panel OBJECT the mock
 * returns (built in `window.createWebviewPanel` below) carries the live
 * listeners; this record is the test-facing view of what the extension set.
 */
export interface MockWebviewPanel {
  viewType: string;
  title: string;
  options: unknown;
  /** The last HTML assigned to `webview.html`. */
  html: string;
  /** How many times `reveal()` was called (singleton-reveal proof). */
  revealCount: number;
  /** `webview.onDidReceiveMessage` listeners — fire these to drive the panel. */
  messageListeners: ((message: unknown) => void)[];
  /** `onDidDispose` listeners. */
  disposeListeners: (() => void)[];
  disposed: boolean;
}

export interface MockState {
  /** The Server Manager extension `extensions.getExtension` returns (undefined = absent). */
  serverManager: MockServerManagerExtension | undefined;
  /** Backing store for `workspace.getConfiguration(section).get/inspect/update`, keyed `"<section>.<key>"`. */
  configStore: Map<string, unknown>;
  /**
   * Workspace-scoped backing store (the real `.vscode/settings.json` layer).
   * `get` returns this over `configStore` (the real merged-read precedence),
   * `inspect` surfaces it as `workspaceValue`, and `update(…, Workspace)`
   * writes here — shapes the real API produces (32.2 review: the governance
   * choose-file write selects the OWNING scope via inspect).
   */
  configWorkspaceStore: Map<string, unknown>;
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
  /** Webview panels created via `window.createWebviewPanel`. */
  webviewPanels: MockWebviewPanel[];
  /** Scripted `showOpenDialog` resolution — an array of `{ fsPath }` Uris, or undefined (dismissed). */
  openDialogResponse: { fsPath: string }[] | undefined;
  /**
   * Scripted `showInputBox` responder — resolves the typed string, or
   * `undefined` when dismissed (the DEFAULT, a shape every real input box can
   * produce). Receives the options the extension passed so a responder can
   * branch on `password`/`prompt`.
   */
  inputBoxResponder: (options: { prompt?: string; password?: boolean; placeHolder?: string }) => string | undefined;
  /** Recorded `showInputBox` option tuples (assert the hidden-password gesture). */
  inputBoxCalls: { prompt?: string; password?: boolean; placeHolder?: string }[];
  /** `workspace.onDidChangeConfiguration` listeners. */
  configChangeListeners: ((event: { affectsConfiguration(section: string): boolean }) => void)[];
}

export const mockState: MockState = {
  serverManager: undefined,
  configStore: new Map(),
  configWorkspaceStore: new Map(),
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
  webviewPanels: [],
  openDialogResponse: undefined,
  inputBoxResponder: () => undefined,
  inputBoxCalls: [],
  configChangeListeners: [],
};

/** Restore every piece of scripted editor state between tests. */
export function resetMockState(): void {
  mockState.serverManager = undefined;
  mockState.configStore = new Map();
  mockState.configWorkspaceStore = new Map();
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
  mockState.webviewPanels = [];
  mockState.openDialogResponse = undefined;
  mockState.inputBoxResponder = () => undefined;
  mockState.inputBoxCalls = [];
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

  /**
   * Mirrors the declared `window.showOpenDialog`: resolves `Uri[] | undefined`.
   * The scripted Uri carries `fsPath` — the one member the extension reads
   * (a real Uri always has it).
   */
  showOpenDialog: (_options?: unknown): Promise<{ fsPath: string }[] | undefined> =>
    Promise.resolve(mockState.openDialogResponse),

  /**
   * Mirrors the declared `window.showInputBox`: resolves `string | undefined`
   * (the typed string, or `undefined` on dismiss — the default responder's
   * shape). The options tuple is recorded so tests can assert the
   * hidden-password gesture (`password: true`).
   */
  showInputBox: (options: { prompt?: string; password?: boolean; placeHolder?: string }): Promise<string | undefined> => {
    mockState.inputBoxCalls.push(options);
    return Promise.resolve(mockState.inputBoxResponder(options));
  },

  /**
   * Mirrors the declared `window.createWebviewPanel` shape as the extension's
   * governance panel adapter uses it: a settable `webview.html`,
   * `webview.onDidReceiveMessage`/`onDidDispose` event registrars (returning
   * Disposables), and `reveal()`. The created panel is recorded in
   * `mockState.webviewPanels` so tests can read the HTML and fire messages.
   */
  createWebviewPanel: (
    viewType: string,
    title: string,
    _showOptions: unknown,
    options?: unknown,
  ): {
    webview: {
      html: string;
      onDidReceiveMessage(listener: (message: unknown) => void): MockDisposable;
    };
    onDidDispose(listener: () => void): MockDisposable;
    reveal(): void;
    dispose(): void;
  } => {
    const recorded: MockWebviewPanel = {
      viewType,
      title,
      options,
      html: "",
      revealCount: 0,
      messageListeners: [],
      disposeListeners: [],
      disposed: false,
    };
    mockState.webviewPanels.push(recorded);
    return {
      webview: {
        get html(): string {
          return recorded.html;
        },
        set html(value: string) {
          recorded.html = value;
        },
        onDidReceiveMessage: (listener: (message: unknown) => void): MockDisposable => {
          recorded.messageListeners.push(listener);
          return disposable();
        },
      },
      onDidDispose: (listener: () => void): MockDisposable => {
        recorded.disposeListeners.push(listener);
        return disposable();
      },
      reveal: (): void => {
        recorded.revealCount++;
      },
      dispose: (): void => {
        recorded.disposed = true;
        for (const listener of recorded.disposeListeners) listener();
      },
    };
  },
};

export const workspace = {
  getConfiguration: (section: string) => ({
    get: <T>(key: string, defaultValue: T): T => {
      const fullKey = `${section}.${key}`;
      // The real merged read: a workspace-scoped value shadows the global one.
      if (mockState.configWorkspaceStore.has(fullKey)) {
        return mockState.configWorkspaceStore.get(fullKey) as T;
      }
      return mockState.configStore.has(fullKey)
        ? (mockState.configStore.get(fullKey) as T)
        : defaultValue;
    },
    inspect: <T>(key: string): { globalValue?: T; workspaceValue?: T } | undefined => {
      const fullKey = `${section}.${key}`;
      // The real return shape carries one field per scope the value is
      // defined in; a nowhere-defined value yields `undefined` — both real
      // shapes.
      const globalValue = mockState.configStore.has(fullKey)
        ? (mockState.configStore.get(fullKey) as T)
        : undefined;
      const workspaceValue = mockState.configWorkspaceStore.has(fullKey)
        ? (mockState.configWorkspaceStore.get(fullKey) as T)
        : undefined;
      if (globalValue === undefined && workspaceValue === undefined) return undefined;
      return {
        ...(globalValue !== undefined ? { globalValue } : {}),
        ...(workspaceValue !== undefined ? { workspaceValue } : {}),
      };
    },
    update: (key: string, value: unknown, target?: number): Promise<void> => {
      mockState.configUpdates.push({ key, value, target });
      if (target === ConfigurationTarget.Workspace) {
        mockState.configWorkspaceStore.set(`${section}.${key}`, value);
      } else {
        mockState.configStore.set(`${section}.${key}`, value);
      }
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

/** Mirrors the declared `vscode.ViewColumn` enum members the extension uses. */
export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
} as const;
