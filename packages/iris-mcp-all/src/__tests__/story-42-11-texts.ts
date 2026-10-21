/**
 * Story 42.11 (DW-652; AD-15) - the texts the story adds to the `iris_doc_load`, `iris_doc_xml_export` and `iris_env_promote` tool
 * listings, written here from the Design Notes of the spec and read by the ledger tests as their oracle. Nothing in this file is read
 * from the ledger or from the sources, so a ledger entry or a tool text that drifts from the spec fails against it.
 */

/** The three tools whose listing the story changes (all on the `iris-dev-mcp` server). */
export const STORAGE_GUARD_TOOLS = ["iris_doc_load", "iris_doc_xml_export", "iris_env_promote"] as const;

/** The new `allowStorageRegeneration` property of each tool's `inputSchema`, in the key order of a frozen boolean sibling. */
export const STORAGE_GUARD_PROPERTY: Record<string, { description: string; type: "boolean" }> = {
  iris_doc_load: {
    description:
      "Boolean (true/false), default false. When false, a class file whose content drops one of the Storage definitions the class has now is refused (a failures entry with code STORAGE_DROPPED; nothing is stored for that file, and the other files continue); changing a Storage definition's content is allowed. When true, the file is uploaded, IRIS generates new storage at the next compile (which can change how existing rows are read), and the result's storageDrops names the dropped definitions. No effect on a new class or on other document types.",
    type: "boolean",
  },
  iris_doc_xml_export: {
    description:
      'For action "import" only. Boolean (true/false), default false. When false, an import is refused (STORAGE_DROPPED, nothing loaded) if the XML of a class lacks one of the Storage definitions that class has now; changing a definition\'s content is allowed. When true, the import goes ahead, IRIS generates new storage at the next compile (which can change how existing rows are read), and the result\'s storageDrops names the dropped definitions. No effect on a new class or on other document types.',
    type: "boolean",
  },
  iris_env_promote: {
    description:
      "For action 'execute' only. Boolean (true/false), default false. When false, 'execute' is refused before any write (STORAGE_DROPPED) if the source copy of a promoted class lacks one of the Storage definitions the target class has now; changing a definition's content is allowed. When true, the classes are promoted, IRIS generates new storage on the target at the next compile (which can change how existing rows are read), and the confirmation dialog and the result's storageDrops name the dropped definitions.",
    type: "boolean",
  },
};

/** The frozen `iris_doc_load` `ignoreConflict` text, and the text Story 42.11 corrects it to (the one phrase that changes). */
export const IGNORE_CONFLICT_BEFORE =
  "If true (default), each file overwrites its server copy unconditionally. If false, a file whose document already exists is saved under a version check: it is overwritten unless the document changes on the server while it is being saved, in which case that file fails with DOCUMENT_CONFLICT and the others continue.";
export const IGNORE_CONFLICT_AFTER =
  "If true (default), each file overwrites its server copy without a version check. If false, a file whose document already exists is saved under a version check: it is overwritten unless the document changes on the server while it is being saved, in which case that file fails with DOCUMENT_CONFLICT and the others continue.";

/** The separator and the sentence appended to each tool's description (after the 43.4 passage, for `iris_env_promote`). */
export const STORAGE_GUARD_SENTENCE: Record<string, { separator: string; sentence: string }> = {
  iris_doc_load: {
    separator: " ",
    sentence:
      "For an existing class, a file whose content drops one of the class's Storage definitions is refused and nothing is stored for that file (a failures entry with code STORAGE_DROPPED; the other files continue), because IRIS would generate new storage at the next compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions.",
  },
  iris_doc_xml_export: {
    separator: " ",
    sentence:
      "An import that would drop one of the Storage definitions a class has now (its XML lacks that definition) is refused with STORAGE_DROPPED and nothing is loaded, because IRIS would generate new storage at the next compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions.",
  },
  iris_env_promote: {
    separator: "\n\n",
    sentence:
      "STORAGE GUARD -- before the confirmation dialog and before any write, 'execute' reads the source and target copy of each class it would promote; if a source copy lacks one of the Storage definitions the target class has now, the whole execute is refused with STORAGE_DROPPED and nothing changes, because IRIS would generate new storage on the target at the next compile, which can change how existing rows are read. allowStorageRegeneration (default false) lets it through; the dialog and the result then name the dropped definitions.",
  },
};
