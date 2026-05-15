import type { BaseDefinition } from "@aliou/obsdx-base-ast";
import { parseBase, validateBase } from "@aliou/obsdx-base-ast";
import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { Type } from "typebox";
import { baseRequiresContext } from "../base/context";
import {
  inferPropertyType,
  isTextReadable,
  loadPropertyTypes,
  type NoteProperty,
  validateToolPath,
} from "../guardrails";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateLines,
} from "../truncation";
import type { ObsidianTool } from "../types";
import { errorText, pathDisplayName, text } from "../utils";

const parameters = Type.Object({
  path: Type.String({
    description:
      "Vault-relative path of the file to read, such as /Notes/Plan.md.",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed).",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of lines to read.",
    }),
  ),
});

export const readToolDefinition = {
  name: "read",
  label: "Read file",
  description: `Read a note, Base, or text file from the Obsidian vault. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
  promptGuidelines: [
    "Use read before summarizing or modifying a note unless its current content is already visible in the chat.",
    "Use read with vault-relative paths; prefer absolute-looking vault paths such as /Folder/Note.md.",
  ],
} as const;

interface ReadDetails {
  path: string;
  kind: "note" | "base" | "file";
  properties?: NoteProperty[];
  frontmatterExists?: boolean;
  // Base-specific details.
  columns?: string[];
  formulas?: Array<{
    name: string;
    expression: string;
    requiresContext: boolean;
  }>;
  views?: Array<{
    name: string;
    type: string;
    columns: string[];
    filters?: unknown;
    sort?: unknown;
    limit?: number;
    groupBy?: unknown;
    summaries?: Record<string, unknown>;
    requiresContext: boolean;
  }>;
  requiresContext?: boolean;
  validationErrors?: string[];
  // Truncation details.
  bodyOffset?: number;
  outputLines?: number;
  totalLines?: number;
  truncated?: boolean;
}

/**
 * Format frontmatter properties as YAML-like block for content output.
 */
function formatPropertiesBlock(properties: NoteProperty[]): string {
  const lines: string[] = ["---"];
  for (const prop of properties) {
    lines.push(`${prop.name}: ${formatPropertyValue(prop.value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function formatPropertyValue(value: unknown): string {
  const truncate = (content: string, max = 200) =>
    content.length > max ? `${content.slice(0, max)}…` : content;
  if (Array.isArray(value)) {
    const shown = value.slice(0, 20).map((item) => truncate(String(item), 80));
    const suffix =
      value.length > shown.length ? `, …(+${value.length - shown.length})` : "";
    return `[${shown.join(", ")}${suffix}]`;
  }
  if (typeof value === "string") return truncate(value);
  return truncate(JSON.stringify(value));
}

/**
 * Extract properties from Obsidian metadata cache, removing raw frontmatter
 * from the body content.
 */
function extractNoteProperties(
  app: App,
  file: TFile,
  rawContent: string,
  propertyTypes: Record<string, string>,
): { properties: NoteProperty[]; body: string; frontmatterExists: boolean } {
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;

  if (!frontmatter) {
    return {
      properties: [],
      body: rawContent,
      frontmatterExists: false,
    };
  }

  // Build property records from frontmatter.
  const properties: NoteProperty[] = [];
  for (const [name, value] of Object.entries(frontmatter)) {
    if (name === "position") continue;
    const type = propertyTypes[name] ?? inferPropertyType(value);
    properties.push({ name, value, type });
  }

  // Remove raw frontmatter block from body.
  // Obsidian frontmatter is between --- delimiters at the start of the file.
  const body = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  return { properties, body, frontmatterExists: true };
}

/**
 * Format a Base definition as compact readable text for content output.
 */
function formatBaseContent(
  base: BaseDefinition,
  validationErrors: string[],
): string {
  const lines: string[] = [];
  lines.push(`base: ${base.path}`);

  if (base.views.length > 0) {
    lines.push("views:");
    for (const view of base.views) {
      const cols = view.order?.join(", ") || "(default columns)";
      lines.push(`- ${view.name || "Unnamed"}: ${cols}`);
    }
  }

  if (base.filters) {
    lines.push(`filters: ${formatFilterInline(base.filters)}`);
  }

  const ctx = baseRequiresContext(base);
  if (ctx.requiresContext) {
    lines.push(
      `context: required (${ctx.reasons.map((r) => (r.scope === "formula" ? r.name : r.scope)).join(", ")})`,
    );
  } else {
    lines.push("context: not required");
  }

  const formulaEntries = Object.entries(base.formulas);
  if (formulaEntries.length > 0) {
    lines.push("formulas:");
    for (const [name, expr] of formulaEntries) {
      const requiresCtx = /\bthis\b/.test(expr);
      lines.push(
        `- ${name}: ${expr}${requiresCtx ? " (requires context)" : ""}`,
      );
    }
  }

  if (validationErrors.length > 0) {
    lines.push(`validation: ${validationErrors.length} error(s)`);
    for (const err of validationErrors) {
      lines.push(`  - ${err}`);
    }
  }

  return lines.join("\n");
}

function formatFilterInline(filter: unknown): string {
  if (typeof filter === "string") return filter;
  if (filter === null || filter === undefined) return "";
  return JSON.stringify(filter);
}

/**
 * Read a .base file and return structured output.
 */
async function readBase(
  env: ExecutionEnv,
  path: string,
): Promise<
  | { ok: true; content: string; details: ReadDetails }
  | { ok: false; error: string }
> {
  const readResult = await env.readTextFile(path);
  if (!readResult.ok) return { ok: false, error: readResult.error.message };

  try {
    const vaultPath = path.replace(/^\/+/, "");
    const base = parseBase(vaultPath, readResult.value);
    const validationErrors = validateBase(base);

    const content = formatBaseContent(base, validationErrors);

    const ctx = baseRequiresContext(base);

    const propertyKeys = Object.keys(base.properties);
    const orderKeys = base.views.flatMap((view) => view.order ?? []);
    const columns = [...new Set([...propertyKeys, ...orderKeys])];

    const formulas = Object.entries(base.formulas).map(([name, expr]) => ({
      name,
      expression: expr,
      requiresContext: /\bthis\b/.test(expr),
    }));

    const views = base.views.map((view) => {
      const viewCtx = baseRequiresContext(base, view.name);
      return {
        name: view.name,
        type: view.type,
        columns: view.order ?? [],
        filters: view.filters,
        sort: view.sort,
        limit: view.limit,
        groupBy: view.groupBy,
        summaries: view.summaries as Record<string, unknown> | undefined,
        requiresContext: viewCtx.requiresContext,
      };
    });

    return {
      ok: true,
      content,
      details: {
        path,
        kind: "base",
        columns,
        formulas,
        views,
        requiresContext: ctx.requiresContext,
        validationErrors,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createReadTool(
  env: ExecutionEnv,
  app: App,
): ObsidianTool<typeof parameters> {
  return {
    ...readToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const validated = validateToolPath(params.path);
      if (!validated.ok) return errorText(validated.error);

      const path = validated.envPath;
      const fileName = validated.vaultPath.split("/").pop() ?? "";

      // Check if this is a .base file.
      if (fileName.endsWith(".base")) {
        const result = await readBase(env, path);
        if (!result.ok) return errorText(result.error);
        return text(result.content, result.details);
      }

      // Check if the file is text-readable.
      if (!isTextReadable(fileName)) {
        return errorText(`Cannot read binary file: ${validated.displayPath}`);
      }

      // Read the raw content.
      const readResult = await env.readTextFile(path);
      if (!readResult.ok)
        return errorText(readResult.error.message, readResult.error);

      const rawContent = readResult.value;

      // For markdown notes, extract properties and body.
      if (fileName.endsWith(".md")) {
        const abstractFile = app.vault.getAbstractFileByPath(
          validated.vaultPath,
        );
        if (abstractFile instanceof TFile) {
          const propertyTypes = await loadPropertyTypes(app);
          const { properties, body, frontmatterExists } = extractNoteProperties(
            app,
            abstractFile,
            rawContent,
            propertyTypes,
          );

          const allBodyLines = body.split(/\r?\n/);
          // Remove leading empty line(s) that can result from frontmatter removal.
          while (allBodyLines.length > 0 && allBodyLines[0] === "") {
            allBodyLines.shift();
          }

          const truncation = truncateLines(allBodyLines, {
            offset: params.offset,
            limit: params.limit,
          });

          let content: string;
          if (properties.length > 0) {
            content = `${formatPropertiesBlock(properties)}\n\n${truncation.content}`;
          } else {
            content = truncation.content;
          }

          return text(content, {
            path,
            kind: "note",
            properties,
            frontmatterExists,
            bodyOffset: truncation.startLine,
            outputLines: truncation.outputLines,
            totalLines: truncation.totalLines,
            truncated: truncation.truncated,
          } satisfies ReadDetails);
        }
      }

      // Other text files: raw content with truncation.
      const allLines = rawContent.split(/\r?\n/);
      const truncation = truncateLines(allLines, {
        offset: params.offset,
        limit: params.limit,
      });

      return text(truncation.content, {
        path,
        kind: "file",
        bodyOffset: truncation.startLine,
        outputLines: truncation.outputLines,
        totalLines: truncation.totalLines,
        truncated: truncation.truncated,
      } satisfies ReadDetails);
    },

    renderTitle(label, args) {
      return `${label}: \`${pathDisplayName(args.path)}\``;
    },

    renderBody(el, args, result, ctx) {
      if (!result) {
        el.createDiv({ cls: "pi-chat-tool-section-title", text: "Reading…" });
        return;
      }
      const content =
        result.content[0]?.type === "text" ? result.content[0].text : "";

      const details = result.details as ReadDetails | undefined;
      const section = el.createDiv("pi-chat-tool-section");

      // Show properties separately if present.
      if (details?.properties && details.properties.length > 0) {
        const propSection = section.createDiv("pi-chat-tool-section");
        propSection.createDiv({
          cls: "pi-chat-tool-section-title",
          text: `Properties (${details.properties.length})`,
        });
        const propList = propSection.createDiv("pi-chat-tool-list");
        for (const prop of details.properties) {
          const row = propList.createDiv("pi-chat-tool-list-entry");
          row.createSpan({
            cls: "pi-chat-tool-list-badge is-property",
            text: prop.type,
          });
          row.createSpan({
            cls: "pi-chat-tool-list-key",
            text: prop.name,
          });
          row.createSpan({
            cls: "pi-chat-tool-list-value",
            text: Array.isArray(prop.value)
              ? prop.value.join(", ")
              : String(prop.value),
          });
        }
      }

      // Show body/content.
      section.createDiv({
        cls: "pi-chat-tool-section-title",
        text: args.path,
      });

      if (details?.truncated) {
        const notice = section.createDiv({
          cls: "pi-chat-tool-truncation-notice",
        });
        const shown = details.outputLines ?? 0;
        const total = details.totalLines ?? 0;
        notice.textContent = `Showing ${shown} of ${total} lines`;
      }

      section.createEl("pre", {
        cls: ctx.status === "error" ? "is-error" : undefined,
        text: content,
      });
    },

    renderMarkdown(args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error reading \`${args.path}\`**\n\n${codeBlock(msg, "text")}`;
      }

      const content =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as ReadDetails | undefined;

      const lang =
        details?.kind === "note"
          ? "markdown"
          : details?.kind === "base"
            ? "yaml"
            : "";
      let out = `**\`${args.path}\`**`;
      if (details?.truncated && details.outputLines && details.totalLines) {
        out += ` — _showing ${details.outputLines} of ${details.totalLines} lines_`;
      }
      return `${out}\n\n${codeBlock(content, lang)}`;
    },
  };
}

function codeBlock(text: string, lang = ""): string {
  let maxTicks = 2;
  for (const match of text.matchAll(/`+/g)) {
    maxTicks = Math.max(maxTicks, match[0].length);
  }
  const fence = "`".repeat(maxTicks + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}
