import {
  AgentHarness,
  type Session,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { ObsidianExecutionEnv } from "@/harness/env";
import type { ModelRegistry } from "@/harness/model-registry";
import type {
  FlintSessionMetadata,
  ObsidianSessionRepo,
} from "@/harness/session";
import type { ObsidianTool } from "@/harness/tools";
import { createVaultTools } from "@/harness/tools";
import type { FlintSettings } from "@/settings/types";
import {
  buildObsidianSystemPrompt,
  loadAgentInstructions,
} from "./system-prompt";

export type ResolvedCredential = {
  apiKey: string;
  headers?: Record<string, string>;
};

export interface CreateObsidianHarnessDeps {
  app: App;
  env: ObsidianExecutionEnv;
  sessionRepo: ObsidianSessionRepo;
  modelRegistry: ModelRegistry;
  getSettings: () => FlintSettings;
  resolveCredential: (
    model: Model<Api>,
  ) => Promise<ResolvedCredential | undefined>;
}

export interface CreateObsidianHarnessResult {
  harness: AgentHarness;
  session: Session<FlintSessionMetadata>;
  tools: ObsidianTool[];
  currentSessionPath: string;
  currentSessionId: string;
}

export async function createObsidianHarness(
  deps: CreateObsidianHarnessDeps,
  metadata?: FlintSessionMetadata,
): Promise<CreateObsidianHarnessResult> {
  const { env, sessionRepo } = deps;
  const session = metadata
    ? await sessionRepo.open(metadata)
    : await sessionRepo.create();
  const context = await session.buildContext();
  const settings = deps.getSettings();

  const { model, thinkingLevel } = await deps.modelRegistry.resolveHarnessModel(
    {
      restored: context.model
        ? {
            provider: context.model.provider,
            modelId: context.model.modelId,
          }
        : undefined,
      thinkingLevel:
        (context.thinkingLevel as ThinkingLevel | undefined) ??
        settings.thinkingLevel,
    },
  );

  const sessionMeta = await session.getMetadata();

  const tools = createVaultTools(env, deps.app);
  const enabledToolNames = deps.getSettings().enabledTools;
  const harness = new AgentHarness({
    env,
    session,
    model,
    thinkingLevel: model.reasoning ? thinkingLevel : "off",
    tools,
    activeToolNames: enabledToolNames,
    systemPrompt: async ({ activeTools, resources }) => {
      const currentSettings = deps.getSettings();
      return buildObsidianSystemPrompt({
        activeTools: activeTools as ObsidianTool[],
        agentInstructions: await loadAgentInstructions(
          env,
          currentSettings.agentFilePath,
        ),
        skills: resources.skills,
        userSystemPrompt: currentSettings.systemPrompt,
      });
    },
    getApiKeyAndHeaders: async (requestModel) =>
      deps.resolveCredential(requestModel as Model<Api>),
  });

  return {
    harness,
    session,
    tools,
    currentSessionPath: sessionMeta.path,
    currentSessionId: sessionMeta.id,
  };
}
