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
 * Check whether the original keys in `base` are preserved in `target`.
 * New keys in `target` that don't exist in `base` (e.g. from default normalization)
 * are ignored. Only modifications or removals of existing keys are flagged.
 */
function hasOriginalKeysChanged(base: unknown, target: unknown): boolean {
  if (base === target) {
    return false;
  }
  if (base == null && target == null) {
    return false;
  }
  if (base == null || target == null) {
    return true;
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(target) || base.length !== target.length) {
      return true;
    }
    for (let i = 0; i < base.length; i++) {
      if (hasOriginalKeysChanged(base[i], target[i])) {
        return true;
      }
    }
    return false;
  }

  if (typeof base === "object" && typeof target === "object") {
    const baseObj = base as Record<string, unknown>;
    const targetObj = target as Record<string, unknown>;
    for (const key of Object.keys(baseObj)) {
      if (!(key in targetObj)) {
        return true;
      } // key removed
      if (hasOriginalKeysChanged(baseObj[key], targetObj[key])) {
        return true;
      }
    }
    return false;
  }

  return !isDeepStrictEqual(base, target);
}

/**
 * Compare oldConfig and newConfig for each locked/constrained field.
 * For locked fields, only flags modifications or removals of existing keys;
 * new keys added by default normalization are tolerated.
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
      if (hasOriginalKeysChanged(oldValue, newValue)) {
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
