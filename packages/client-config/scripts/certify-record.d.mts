export declare function mergeCertificationRecord(
  existing: Record<string, unknown> | undefined,
  record: Record<string, unknown>,
  passOk: boolean,
): { action: "keep" } | { action: "write"; merged: Record<string, unknown> };

export declare function passCreatedPaths(pre: string[], post: string[]): string[];
