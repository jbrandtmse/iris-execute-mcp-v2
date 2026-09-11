export declare function mergeCertificationRecord(
  existing: Record<string, unknown> | undefined,
  record: Record<string, unknown>,
  passOk: boolean,
): { action: "keep" } | { action: "write"; merged: Record<string, unknown> };

export declare function passCreatedPaths(pre: string[], post: string[]): string[];

export declare function decideRestoreRung(args: {
  configMatches: boolean;
  availableBackups: string[];
  engineRestoreAttempted: boolean;
}): { rung: "none" } | { rung: "engine-restore"; backup: string } | { rung: "raw-restore" };

export declare function timeoutSuffix(result: { timedOut?: boolean }): string;

export declare function excerpt(text: string, max?: number): string;

export declare function parseCertifyArgs(argv: string[]): {
  subcommand: string | undefined;
  positional: string[];
  flags: Set<string>;
  options: Map<string, string>;
};
