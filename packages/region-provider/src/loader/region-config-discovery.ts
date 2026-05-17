import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Dirent } from "node:fs";
import type { DeclarativeRegionConfig } from "@opuspopuli/common";

/**
 * Shape of a region plugin JSON config file.
 *
 * The outer fields (name, displayName, etc.) map to region_plugins table columns.
 * The `config` field is a full DeclarativeRegionConfig passed to the scraping pipeline.
 */
export interface RegionPluginFile {
  name: string;
  displayName: string;
  description: string;
  version: string;
  config: DeclarativeRegionConfig;
}

/**
 * Discover and validate region plugin JSON config files from a directory tree.
 *
 * Recursively walks `regionsDir`, collecting every *.json file at any depth.
 * This supports the nested layout introduced with per-state subdirectories and
 * county configs (e.g. regions/california/california.json,
 * regions/california/counties/sonoma/sonoma.json).
 *
 * @throws Error if a JSON file is malformed or missing required fields
 * @returns Empty array if the directory doesn't exist or contains no JSON files
 */
export async function discoverRegionConfigs(
  regionsDir: string,
): Promise<RegionPluginFile[]> {
  const configs: RegionPluginFile[] = [];
  await collectConfigs(regionsDir, regionsDir, configs);
  return configs;
}

async function collectConfigs(
  rootDir: string,
  dir: string,
  configs: RegionPluginFile[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectConfigs(rootDir, join(dir, entry.name), configs);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const filePath = join(dir, entry.name);
      const relPath = relative(rootDir, filePath);
      const raw = await readFile(filePath, "utf-8");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TypeError(`Invalid JSON in region config file: ${relPath}`);
      }

      const pluginFile = validateRegionPluginFile(parsed, relPath);
      configs.push(pluginFile);
    }
  }
}

function validateRegionPluginFile(
  data: unknown,
  fileName: string,
): RegionPluginFile {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TypeError(`Region config "${fileName}" must be a JSON object`);
  }

  const obj = data as Record<string, unknown>;

  // Validate outer fields
  for (const field of ["name", "displayName", "version"] as const) {
    if (typeof obj[field] !== "string" || (obj[field] as string).length === 0) {
      throw new TypeError(
        `Region config "${fileName}" is missing required field "${field}"`,
      );
    }
  }

  if (typeof obj.description !== "string") {
    throw new TypeError(
      `Region config "${fileName}" is missing required field "description"`,
    );
  }

  // Validate config object
  if (typeof obj.config !== "object" || obj.config === null) {
    throw new TypeError(
      `Region config "${fileName}" is missing required field "config"`,
    );
  }

  const config = obj.config as Record<string, unknown>;

  if (typeof config.regionId !== "string" || config.regionId.length === 0) {
    throw new TypeError(
      `Region config "${fileName}" is missing required field "config.regionId"`,
    );
  }

  if (!Array.isArray(config.dataSources) || config.dataSources.length === 0) {
    throw new TypeError(
      `Region config "${fileName}" must have at least one entry in "config.dataSources"`,
    );
  }

  // Validate each data source
  for (let i = 0; i < config.dataSources.length; i++) {
    const ds = config.dataSources[i] as Record<string, unknown>;
    for (const field of ["url", "dataType", "contentGoal"] as const) {
      if (typeof ds[field] !== "string" || (ds[field] as string).length === 0) {
        throw new TypeError(
          `Region config "${fileName}" dataSources[${i}] is missing required field "${field}"`,
        );
      }
    }
  }

  return {
    name: obj.name as string,
    displayName: obj.displayName as string,
    description: obj.description as string,
    version: obj.version as string,
    config: config as unknown as DeclarativeRegionConfig,
  };
}
