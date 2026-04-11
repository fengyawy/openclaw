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

function matchesPolicy(changedPath: string, prefix: string): "exact" | "child" | "bulk" | null {
  if (changedPath === prefix) {
    return "exact";
  }
  if (changedPath.startsWith(`${prefix}.`) || changedPath.startsWith(`${prefix}[`)) {
    return "child";
  }
  if (prefix.startsWith(`${changedPath}.`)) {
    return "bulk";
  }
  return null;
}

/**
 * Check whether any changed paths between oldConfig and newConfig violate
 * the write policy. Returns null if OK, or an error message string.
 */
export function checkWritePolicy(
  newConfig: OpenClawConfig,
  changedPaths: Set<string>,
): string | null {
  for (const changed of changedPaths) {
    for (const [prefix, policy] of WRITE_POLICY) {
      const match = matchesPolicy(changed, prefix);
      if (!match) {
        continue;
      }

      if (policy.type === "locked") {
        return `Field "${changed}" is locked and cannot be modified.`;
      }

      if (policy.type === "enum" && match === "exact") {
        const newValue = getNestedValue(newConfig, prefix);
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
      const match = matchesPolicy(dotPath, prefix);
      if (!match) {
        continue;
      }
      if (policy.type === "locked") {
        return `Field "${dotPath}" is locked and cannot be removed.`;
      }
      // enum fields: unsetting is effectively setting to undefined, not allowed
      if (policy.type === "enum" && match === "exact") {
        return `Field "${dotPath}" is constrained and cannot be removed.`;
      }
    }
  }
  return null;
}
