import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionStats } from "@/settings/types";

export function buildSessionStats(
  messages: AgentMessage[],
  model: Model<Api> | undefined,
): SessionStats {
  const tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  let cost = 0;
  for (const message of messages) {
    const usage = "usage" in message ? message.usage : undefined;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    tokens.total += usage.totalTokens ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  const contextWindow =
    model?.contextWindow && model.contextWindow > 0
      ? model.contextWindow
      : undefined;
  const contextTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return {
    totalMessages: messages.length,
    tokens,
    cost,
    ...(contextWindow
      ? {
          contextWindow,
          contextPercent: (contextTokens / contextWindow) * 100,
        }
      : {}),
  };
}
