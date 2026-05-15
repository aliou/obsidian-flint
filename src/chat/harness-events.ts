import type {
  AgentHarnessEvent,
  AgentMessage,
} from "@earendil-works/pi-agent-core";
import type { ToolRun } from "@/settings/types";

export type ChatRuntimeState = {
  messages: AgentMessage[];
  toolRuns: Map<string, ToolRun>;
  isRunning: boolean;
};

function replaceLastAssistant(
  messages: AgentMessage[],
  message: AgentMessage,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      messages[index] = message;
      return;
    }
  }
  messages.push(message);
}

function replaceLastMatchingMessage(
  messages: AgentMessage[],
  message: AgentMessage,
): void {
  const last = messages[messages.length - 1];
  if (last?.role === message.role) {
    messages[messages.length - 1] = message;
    return;
  }
  if (message.role === "assistant") {
    replaceLastAssistant(messages, message);
    return;
  }
  messages.push(message);
}

export function applyHarnessEvent(
  state: ChatRuntimeState,
  event: AgentHarnessEvent,
): void {
  switch (event.type) {
    case "agent_start":
      state.isRunning = true;
      break;
    case "agent_end":
      state.isRunning = false;
      break;
    case "message_start":
      state.messages.push(event.message);
      break;
    case "message_update":
      replaceLastAssistant(state.messages, event.message);
      break;
    case "message_end":
      replaceLastMatchingMessage(state.messages, event.message);
      break;
    case "tool_execution_start":
      state.toolRuns.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        status: "running",
      });
      break;
    case "tool_execution_update":
      state.toolRuns.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        status: "running",
        result: event.partialResult,
      });
      break;
    case "tool_execution_end":
      state.toolRuns.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        args: state.toolRuns.get(event.toolCallId)?.args,
        status: event.isError ? "error" : "done",
        result: event.result,
      });
      break;
  }
}

export function rebuildToolRunsFromMessages(
  toolRuns: Map<string, ToolRun>,
  messages: AgentMessage[],
): void {
  toolRuns.clear();
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        toolRuns.set(part.id, {
          id: part.id,
          name: part.name,
          args: part.arguments,
          status: "running",
        });
      }
    } else if (message.role === "toolResult") {
      const run = toolRuns.get(message.toolCallId);
      toolRuns.set(message.toolCallId, {
        id: message.toolCallId,
        name: message.toolName,
        args: run?.args,
        status: message.isError ? "error" : "done",
        result: {
          content: message.content,
          details: message.details,
          isError: message.isError,
        },
      });
    }
  }
}
