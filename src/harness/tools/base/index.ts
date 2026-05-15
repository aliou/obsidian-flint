import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import type { ObsidianTool } from "../types";
import { createListBasesTool, listBasesToolDefinition } from "./list-bases";
import { createQueryBaseTool, queryBaseToolDefinition } from "./query-base";

export const baseToolDefinitions = [
  listBasesToolDefinition,
  queryBaseToolDefinition,
] as const;

export function createBasesTools(env: ExecutionEnv, app: App): ObsidianTool[] {
  return [createListBasesTool(env), createQueryBaseTool(env, app)];
}
