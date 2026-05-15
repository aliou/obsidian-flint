import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import { baseToolDefinitions, createBasesTools } from "./base";
import type { ObsidianTool } from "./types";
import { createVaultContentTools, vaultContentToolDefinitions } from "./vault";

export const VAULT_TOOL_DEFINITIONS = [
  ...vaultContentToolDefinitions,
  ...baseToolDefinitions,
] as const;

export const DEFAULT_ENABLED_TOOL_NAMES = VAULT_TOOL_DEFINITIONS.map(
  (tool) => tool.name,
);

export type {
  ToolRenderAdapter,
  ToolRenderContext,
  ToolRenderDefaults,
} from "./tool-render-types";
export { toRenderAdapter } from "./tool-render-types";
export type { ObsidianTool } from "./types";

export function createVaultTools(env: ExecutionEnv, app: App): ObsidianTool[] {
  return [...createVaultContentTools(env, app), ...createBasesTools(env, app)];
}
