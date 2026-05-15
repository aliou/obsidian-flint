import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import type { ObsidianTool } from "../types";
import { createDeleteTool, deleteToolDefinition } from "./delete";
import { createFindTool, findToolDefinition } from "./find";
import { createLsTool, lsToolDefinition } from "./ls";
import { createMkdirTool, mkdirToolDefinition } from "./mkdir";
import { createReadTool, readToolDefinition } from "./read";
import { createSearchTool, searchToolDefinition } from "./search";
import { createWriteTool, writeToolDefinition } from "./write";

export const vaultContentToolDefinitions = [
  lsToolDefinition,
  readToolDefinition,
  writeToolDefinition,
  mkdirToolDefinition,
  deleteToolDefinition,
  findToolDefinition,
  searchToolDefinition,
] as const;

export function createVaultContentTools(
  env: ExecutionEnv,
  app: App,
): ObsidianTool[] {
  return [
    createLsTool(env),
    createReadTool(env, app),
    createWriteTool(env),
    createMkdirTool(env),
    createDeleteTool(env, app),
    createFindTool(env),
    createSearchTool(env),
  ];
}
