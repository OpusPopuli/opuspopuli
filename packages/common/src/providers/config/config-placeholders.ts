/**
 * Config Placeholder Resolution
 *
 * Resolves ${variableName} placeholders in config objects.
 * Used to inject runtime context (e.g., the active region's stateCode)
 * into declarative config files before they are passed to plugins.
 */

const PLACEHOLDER_REGEX = /\$\{(\w+)\}/g;

/**
 * Resolve ${variableName} placeholders in a config object.
 *
 * Deep-clones the input, then recursively replaces ${varName} patterns
 * in all string values using the provided variables map.
 * Unresolved placeholders (no matching variable) are left as-is.
 *
 * @param config - The config object to resolve (will be deep-cloned)
 * @param variables - Map of variable names to values (e.g., { stateCode: "CA" })
 * @returns A new config object with placeholders resolved
 */
export function resolveConfigPlaceholders<T>(
  config: T,
  variables: Record<string, string>,
): T {
  if (Object.keys(variables).length === 0) {
    // No variables to resolve — return a clone to maintain the contract
    return structuredClone(config);
  }

  const cloned = structuredClone(config);
  resolveRecursive(cloned, variables);
  return cloned;
}

function resolveRecursive(
  obj: unknown,
  variables: Record<string, string>,
): void {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") {
        obj[i] = resolveString(obj[i] as string, variables);
      } else {
        resolveRecursive(obj[i], variables);
      }
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") {
      record[key] = resolveString(value, variables);
    } else {
      resolveRecursive(value, variables);
    }
  }
}

function resolveString(
  value: string,
  variables: Record<string, string>,
): string {
  return value.replaceAll(PLACEHOLDER_REGEX, (match, varName: string) => {
    return varName in variables ? variables[varName] : match;
  });
}
