import type {
  AgentMessage,
  CompactionSettings,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  getModels,
  getProviders,
  type Model,
} from "@earendil-works/pi-ai";
import { DEFAULT_ENABLED_TOOL_NAMES } from "@/harness/tools";

export const VIEW_TYPE = "flint-view";

export type ProviderAuthConfig = {
  requiresApiKey: boolean;
  secretId?: string;
};

export type CustomProviderModelConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: "text"[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Model<Api>["compat"];
};

export type CustomProviderConfig = {
  id: string;
  name?: string;
  baseUrl: string;
  requiresApiKey?: boolean;
  secretId?: string;
  models: CustomProviderModelConfig[];
};

export type FlintExportSettings = {
  outputDirectory: string;
  includeReasoning: boolean;
  includeToolCalls: boolean;
};

export const DEFAULT_EMPTY_STATE_SUGGESTIONS = [
  "Summarize the active note",
  "Find todos in this vault",
  "Explain how this vault is organized",
];

export type FlintSettings = {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  providerAuth: Record<string, ProviderAuthConfig>;
  customProviders: CustomProviderConfig[];
  favoriteModels: string[];
  /** Custom system prompt template. If empty, a default prompt is used. */
  systemPrompt: string;
  /** Path in the vault to an AGENTS.md instructions file. */
  agentFilePath: string;
  /** Paths in the vault to folders containing SKILL.md files. */
  skillFolders: string[];
  /** Names of enabled vault tools. */
  enabledTools: string[];
  /** Path inside the vault where sessions are stored. */
  sessionStoragePath: string;
  /** Compaction behavior settings. */
  compactionSettings: CompactionSettings;
  /** Optional custom prompt for compaction. */
  compactionCustomPrompt: string;
  /** Prompt chips shown in the empty chat state. */
  emptyStateSuggestions: string[];
  /** Markdown export behavior settings. */
  exportSettings: FlintExportSettings;
};

export type { CompactionSettings } from "@earendil-works/pi-agent-core";
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

export type ToolRun = {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: unknown;
};

export type SessionSummary = {
  path: string;
  name: string;
  createdAt: string;
  messageCount: number;
};

export type SessionStats = {
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextPercent?: number;
  contextWindow?: number;
};

export const DEFAULT_EXPORT_SETTINGS: FlintExportSettings = {
  outputDirectory: "Flint Exports",
  includeReasoning: true,
  includeToolCalls: true,
};

export const DEFAULT_SETTINGS: FlintSettings = {
  provider: "",
  modelId: "",
  thinkingLevel: "off",
  providerAuth: {},
  customProviders: [],
  favoriteModels: [],
  systemPrompt: "",
  agentFilePath: "",
  skillFolders: [],
  enabledTools: [...DEFAULT_ENABLED_TOOL_NAMES],
  sessionStoragePath: "Flint/Sessions",
  compactionSettings: { ...DEFAULT_COMPACTION_SETTINGS },
  compactionCustomPrompt: "",
  emptyStateSuggestions: [...DEFAULT_EMPTY_STATE_SUGGESTIONS],
  exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
};

export function normalizeSettings(
  raw: Partial<FlintSettings> | null | undefined,
): FlintSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    providerAuth: raw?.providerAuth ?? {},
    customProviders: raw?.customProviders ?? [],
    favoriteModels: raw?.favoriteModels ?? [],
    systemPrompt: raw?.systemPrompt ?? "",
    agentFilePath: raw?.agentFilePath ?? "",
    skillFolders: raw?.skillFolders ?? [],
    enabledTools: raw?.enabledTools ?? DEFAULT_SETTINGS.enabledTools,
    sessionStoragePath:
      raw?.sessionStoragePath ?? DEFAULT_SETTINGS.sessionStoragePath,
    compactionSettings: raw?.compactionSettings
      ? { ...DEFAULT_COMPACTION_SETTINGS, ...raw.compactionSettings }
      : { ...DEFAULT_COMPACTION_SETTINGS },
    compactionCustomPrompt: raw?.compactionCustomPrompt ?? "",
    emptyStateSuggestions: raw?.emptyStateSuggestions
      ? [...raw.emptyStateSuggestions]
      : [...DEFAULT_SETTINGS.emptyStateSuggestions],
    exportSettings: raw?.exportSettings
      ? {
          ...DEFAULT_EXPORT_SETTINGS,
          ...raw.exportSettings,
        }
      : { ...DEFAULT_EXPORT_SETTINGS },
  };
}

export function buildCustomModels(
  providers: CustomProviderConfig[],
): Model<Api>[] {
  return providers.flatMap(
    (provider) =>
      provider.models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        api: "openai-completions" as Api,
        provider: provider.id,
        baseUrl: provider.baseUrl.replace(/\/+$/, ""),
        reasoning: model.reasoning,
        input: ["text"],
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        headers: model.headers,
        compat: model.compat,
      })) as Model<Api>[],
  );
}

export function allModels(
  customProviders: CustomProviderConfig[],
): Model<Api>[] {
  return [
    ...buildCustomModels(customProviders),
    ...getProviders().flatMap(
      (provider) => getModels(provider as never) as Model<Api>[],
    ),
  ];
}

export function findModel(
  customProviders: CustomProviderConfig[],
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  return allModels(customProviders).find(
    (model) => model.provider === provider && model.id === modelId,
  );
}

export function providerNames(
  customProviders: CustomProviderConfig[],
): string[] {
  return Array.from(
    new Set(allModels(customProviders).map((model) => model.provider)),
  ).sort((a, b) => a.localeCompare(b));
}

export function modelsForProvider(
  customProviders: CustomProviderConfig[],
  provider: string,
): Model<Api>[] {
  return allModels(customProviders)
    .filter((model) => model.provider === provider)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function ensureValidSelection(settings: FlintSettings): void {
  const providerModels = modelsForProvider(
    settings.customProviders,
    settings.provider,
  );
  if (providerModels.some((model) => model.id === settings.modelId)) return;
  const fallback =
    providerModels[0] ??
    allModels(settings.customProviders).find(
      (m) => m.provider === settings.provider,
    ) ??
    allModels(settings.customProviders)[0];
  if (!fallback) return;
  settings.provider = fallback.provider;
  settings.modelId = fallback.id;
}

export function contentText(
  content: AgentMessage extends { content: infer T } ? T : unknown,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } => part?.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export function sessionNameFromMessages(
  messages: AgentMessage[],
): string | undefined {
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser
    ? contentText(firstUser.content).replace(/\s+/g, " ").trim()
    : "";
  if (!text) return undefined;
  return text.length > 52 ? `${text.slice(0, 49).trim()}...` : text;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCount(value?: number): string {
  if (typeof value !== "number") return "--";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatCost(value?: number): string {
  if (typeof value !== "number") return "--";
  return value.toFixed(3);
}

export function formatPercent(value?: number): string {
  if (typeof value !== "number") return "--";
  return `${value.toFixed(1)}%`;
}

export function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function arraymove(array: string[], from: number, to: number): void {
  if (to < 0 || to >= array.length) return;
  const el = array.splice(from, 1)[0];
  if (el === undefined) return;
  array.splice(to, 0, el);
}

export function normalizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function createDefaultModelConfig(
  id: string,
  name = id,
): CustomProviderModelConfig {
  return {
    id,
    name,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  };
}
