import { isDeepStrictEqual } from "node:util";
import type { OpenClawConfig } from "./types.openclaw.js";

type FieldPolicy = { type: "locked" } | { type: "enum"; values: string[] };

const WRITE_POLICY: ReadonlyArray<[prefix: string, policy: FieldPolicy]> = [
  ["models.providers", { type: "locked" }],
  ["channels.telegram", { type: "locked" }],
  ["channels.line", { type: "locked" }],
  ["update", { type: "locked" }],
  [
    "agents.defaults.model.primary",
    { type: "enum", values: ["litellm/gemini-3.1-pro-preview", "litellm/gemini-3.1-flash"] },
  ],
];

function getNestedValue(obj: unknown, dotPath: string): unknown {
  let current: unknown = obj;
  for (const segment of dotPath.split(".")) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Compare oldConfig and newConfig for each locked/constrained field directly,
 * ignoring default-normalization noise in unrelated fields.
 * Returns null if OK, or an error message string.
 */
export function checkWritePolicy(
  oldConfig: OpenClawConfig,
  newConfig: OpenClawConfig,
): string | null {
  for (const [prefix, policy] of WRITE_POLICY) {
    const oldValue = getNestedValue(oldConfig, prefix);
    const newValue = getNestedValue(newConfig, prefix);

    if (policy.type === "locked") {
      if (!isDeepStrictEqual(oldValue, newValue)) {
        return `Field "${prefix}" is locked and cannot be modified.`;
      }
    }

    if (policy.type === "enum") {
      if (!isDeepStrictEqual(oldValue, newValue)) {
        if (typeof newValue !== "string" || !policy.values.includes(newValue)) {
          return `Field "${prefix}" only accepts: ${policy.values.join(", ")} (got "${String(newValue)}").`;
        }
      }
    }
  }
  return null;
}

/**
 * Check whether any unsetPaths target a locked field.
 * Returns null if OK, or an error message string.
 */
export function checkUnsetPolicy(unsetPaths: ReadonlyArray<ReadonlyArray<string>>): string | null {
  for (const segments of unsetPaths) {
    if (!Array.isArray(segments) || segments.length === 0) {
      continue;
    }
    const dotPath = segments.join(".");
    for (const [prefix, policy] of WRITE_POLICY) {
      const isMatch =
        dotPath === prefix || dotPath.startsWith(`${prefix}.`) || prefix.startsWith(`${dotPath}.`);
      if (!isMatch) {
        continue;
      }
      if (policy.type === "locked") {
        return `Field "${dotPath}" is locked and cannot be removed.`;
      }
      if (policy.type === "enum" && dotPath === prefix) {
        return `Field "${dotPath}" is constrained and cannot be removed.`;
      }
    }
  }
  return null;
}
