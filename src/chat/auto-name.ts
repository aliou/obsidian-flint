import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export type AutoNameSettings = {
  enabled: boolean;
  prompt: string;
  provider?: string;
  modelId?: string;
};

export const DEFAULT_AUTO_NAME_PROMPT = `You name chat sessions.

Call the set_name tool exactly once with a concise name.

Name rules:
- 4-7 words when possible.
- Be specific to the user's durable task or workstream.
- No quotes.
- No markdown.
- No trailing punctuation.`;

export const DEFAULT_AUTO_NAME_SETTINGS: AutoNameSettings = {
  enabled: true,
  prompt: DEFAULT_AUTO_NAME_PROMPT,
};

function messageText(
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

export interface AutoNameDeps {
  resolveCredential: (
    model: Model<Api>,
  ) => Promise<
    { apiKey: string; headers?: Record<string, string> } | undefined
  >;
  getModel: (provider: string, modelId: string) => Model<Api> | undefined;
  getCurrentModel: () => Model<Api> | undefined;
}

/**
 * Run auto-naming for a session. Best-effort; errors are caught and logged.
 *
 * @returns `true` if a name was set, `false` otherwise.
 */
export async function autoNameSession(
  session: Session,
  messages: AgentMessage[],
  settings: AutoNameSettings,
  deps: AutoNameDeps,
): Promise<boolean> {
  if (!settings.enabled) return false;

  // Already named — skip.
  const existingName = await session.getSessionName();
  if (existingName) return false;

  // Need at least one complete user→assistant exchange.
  const firstUser = messages.find(
    (m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user",
  );
  const firstAssistant = messages.find(
    (m): m is Extract<AgentMessage, { role: "assistant" }> =>
      m.role === "assistant" && m.stopReason === "stop",
  );
  if (!firstUser || !firstAssistant) return false;

  try {
    // Resolve model — prefer the configured auto-name model, fall back to session model.
    const model =
      settings.provider && settings.modelId
        ? deps.getModel(settings.provider, settings.modelId)
        : deps.getCurrentModel();
    if (!model) return false;

    const credential = await deps.resolveCredential(model);
    if (!credential) return false;

    const userText = messageText(firstUser.content).slice(0, 2000);
    const assistantText = messageText(firstAssistant.content).slice(0, 2000);

    let named = false;

    const setNameParameters = Type.Object({
      name: Type.String({ description: "The session name." }),
    });

    const nameTool: AgentTool<typeof setNameParameters> = {
      name: "set_name",
      label: "Set session name",
      description: "Set the name for the current session.",
      parameters: setNameParameters,
      execute: async (_toolCallId, params) => {
        const name = params.name.trim().slice(0, 60);
        if (name) {
          await session.appendSessionName(name);
          named = true;
        }
        return {
          content: [{ type: "text", text: name || "(empty)" }],
          details: { name },
        };
      },
    };

    const agent = new Agent({
      initialState: {
        systemPrompt: settings.prompt,
        model,
        tools: [nameTool],
      },
      getApiKey: () => credential.apiKey,
      onPayload: credential.headers
        ? (payload) => {
            if (credential.headers) {
              (payload as Record<string, unknown>).headers = {
                ...(((payload as Record<string, unknown>).headers as Record<
                  string,
                  unknown
                >) ?? {}),
                ...credential.headers,
              };
            }
          }
        : undefined,
    });

    await agent.prompt(
      `<user_message>\n${userText}\n</user_message>\n\n<assistant_response>\n${assistantText}\n</assistant_response>`,
    );

    return named;
  } catch (error) {
    console.debug("Auto-title failed:", error);
    return false;
  }
}
