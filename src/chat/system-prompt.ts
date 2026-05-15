import {
  formatSkillsForSystemPrompt,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type momentFn from "moment";
import { moment } from "obsidian";
import type { ObsidianExecutionEnv } from "@/harness/env";
import type { ObsidianTool } from "@/harness/tools";

export interface BuildObsidianSystemPromptOptions {
  activeTools: ObsidianTool[];
  agentInstructions?: string;
  skills?: Skill[];
  userSystemPrompt: string;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatAvailableTools(tools: ObsidianTool[]): string {
  if (tools.length === 0) return "(none)";
  return tools.map((tool) => `- ${tool.name}`).join("\n");
}

function formatToolGuidelines(tools: ObsidianTool[]): string {
  const guidelines = uniqueNonEmpty([
    "Use Obsidian vault tools to operate on notes, Bases, and folders in the current Obsidian vault.",
    "Use Obsidian vault tools with vault-relative paths. Prefer absolute-looking vault paths such as /Folder/Note.md.",
    'User prompts may contain <obsidian-wikilink path="/Folder/Note.md">Label</obsidian-wikilink>; use the path attribute directly instead of searching for that note.',
    ...tools.flatMap((tool) => tool.promptGuidelines ?? []),
    "Be concise in your responses.",
    "Show note and Base paths clearly when working with vault content.",
  ]);
  return guidelines.map((guideline) => `- ${guideline}`).join("\n");
}

export function buildObsidianSystemPrompt({
  activeTools,
  agentInstructions = "",
  skills = [],
  userSystemPrompt,
}: BuildObsidianSystemPromptOptions): string {
  const parts = [
    "You are Flint running inside Obsidian.",
    "",
    "Available tools:",
    formatAvailableTools(activeTools),
    "",
    "Guidelines:",
    formatToolGuidelines(activeTools),
  ];

  const trimmedUserPrompt = userSystemPrompt.trim();
  if (trimmedUserPrompt) {
    parts.push(
      "",
      "<user_system_prompt>",
      trimmedUserPrompt,
      "</user_system_prompt>",
    );
  }

  const trimmedAgentInstructions = agentInstructions.trim();
  if (trimmedAgentInstructions) {
    parts.push(
      "",
      "# Project Context",
      "",
      "Project-specific instructions and guidelines:",
      "",
      trimmedAgentInstructions,
    );
  }

  const skillsPrompt = formatSkillsForSystemPrompt(skills);
  if (skillsPrompt) parts.push("", skillsPrompt);

  const obsidianMoment = moment as unknown as typeof momentFn;
  parts.push("", `Current date: ${obsidianMoment().format("YYYY-MM-DD")}`);
  return parts.join("\n");
}

export async function loadAgentInstructions(
  env: ObsidianExecutionEnv,
  path: string,
): Promise<string> {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const result = await env.readTextFile(trimmed);
  if (result.ok) return result.value;
  if (result.error.code !== "not_found") {
    console.warn("Could not read AGENTS.md instructions", result.error);
  }
  return "";
}
