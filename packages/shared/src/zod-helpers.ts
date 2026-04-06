/**
 * Shared Zod helpers for tool input schemas.
 *
 * Provides type coercion helpers to handle cases where MCP clients
 * may send string representations of non-string types.
 */

import { z } from "zod";

/**
 * A boolean schema that also accepts string "true"/"false".
 *
 * MCP clients may serialize boolean parameters as strings.
 * This schema accepts both `true`/`false` and `"true"`/`"false"`,
 * coercing strings to their boolean equivalents.
 */
export const booleanParam = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      if (val.toLowerCase() === "true") return true;
      if (val.toLowerCase() === "false") return false;
    }
    return val;
  },
  z.boolean(),
);
