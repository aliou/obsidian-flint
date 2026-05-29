import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ObsidianTool } from "../types";
import { errorText, text } from "../utils";
import { baseRequiresContext } from "./context";
import { listFilesByExtension, parseBaseFile } from "./utils";

const parameters = Type.Object({});

export const listBasesToolDefinition = {
  name: "list_bases",
  label: "List Bases",
  description:
    "List Bases in the vault with their columns, views, and formulas.",
  promptGuidelines: [
    "Use list_bases when the user asks what Bases exist or does not provide a specific Base path.",
    "To read a Base's definition, use read on the .base file.",
  ],
} as const;

interface BaseViewSummary {
  name: string;
  type: string;
  columns: string[];
}

interface BaseSummary {
  path: string;
  columns: string[];
  views: BaseViewSummary[];
  formulas: Array<{ name: string; requiresContext: boolean }>;
  requiresContext: boolean;
  validationErrors: string[];
}

interface BaseError {
  path: string;
  error: string;
}

function buildSummary(parsed: {
  base: {
    views: Array<{
      name: string;
      type: string;
      order?: string[];
      filters?: unknown;
      summaries?: Record<string, unknown>;
    }>;
    properties: Record<string, unknown>;
    formulas: Record<string, string>;
    filters?: unknown;
    summaries?: Record<string, unknown>;
  };
  validationErrors: string[];
}): Omit<BaseSummary, "path"> {
  const propertyKeys = Object.keys(parsed.base.properties);
  const orderKeys = parsed.base.views.flatMap((view) => view.order ?? []);
  const columns = [...new Set([...propertyKeys, ...orderKeys])];

  const views: BaseViewSummary[] = parsed.base.views.map((view) => ({
    name: view.name,
    type: view.type,
    columns: view.order ?? propertyKeys,
  }));

  const formulas = Object.entries(parsed.base.formulas).map(([name, expr]) => ({
    name,
    requiresContext: /\bthis\b/.test(expr),
  }));

  const ctx = baseRequiresContext(parsed.base as never);

  return {
    columns,
    views,
    formulas,
    requiresContext: ctx.requiresContext,
    validationErrors: parsed.validationErrors,
  };
}

export function createListBasesTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...listBasesToolDefinition,
    parameters,
    async execute() {
      const files = await listFilesByExtension(env, "base");
      if (!files.ok) return errorText(files.error);

      const bases: Array<BaseSummary | BaseError> = [];
      for (const file of files.files) {
        const parsed = await parseBaseFile(env, file.path);
        if (!parsed.ok) {
          bases.push({ path: file.path, error: parsed.error });
          continue;
        }
        bases.push({ path: file.path, ...buildSummary(parsed) });
      }

      const lines = bases.map((base) => {
        if ("error" in base) return `${base.path} (parse error: ${base.error})`;

        // Format: path [ViewName: col1, col2; OtherView: col3]
        const viewParts = base.views.map((v) => {
          const cols = v.columns.join(", ") || "(default)";
          return `${v.name}: ${cols}`;
        });
        const viewsStr = viewParts.join("; ");
        return `${base.path} [${viewsStr}]`;
      });

      return text(lines.join("\n") || "(no Bases)", { bases });
    },

    renderTitle(label) {
      return label;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Listing…",
        });
        return;
      }
      if (ctx.status === "error") {
        const msg =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        const section = el.createDiv("flint-chat-tool-section");
        section.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Error",
        });
        section.createEl("pre", { cls: "is-error", text: msg });
        return;
      }

      const details = result.details as
        | { bases?: Array<BaseSummary | BaseError> }
        | undefined;
      const bases = details?.bases;
      if (!bases?.length) {
        el.createDiv({
          cls: "flint-chat-tool-section",
          text: "No Bases found",
        });
        return;
      }

      const section = el.createDiv("flint-chat-tool-section");
      section.createDiv({
        cls: "flint-chat-tool-section-title",
        text: `${bases.length} Base${bases.length === 1 ? "" : "s"}`,
      });

      const list = section.createDiv("flint-chat-tool-list");
      for (const base of bases) {
        const row = list.createDiv("flint-chat-tool-list-entry");
        if ("error" in base) {
          row.createSpan({
            cls: "flint-chat-tool-list-badge is-error",
            text: "error",
          });
          row.createSpan({
            cls: "flint-chat-tool-list-path",
            text: `${base.path} — ${base.error}`,
          });
          continue;
        }
        row.createSpan({
          cls: "flint-chat-tool-list-badge is-file",
          text: "base",
        });
        row.createSpan({
          cls: "flint-chat-tool-list-path",
          text: base.path,
        });

        // Show views with their columns.
        const viewText = base.views
          .map((v) => `${v.name} (${v.type}: ${v.columns.join(", ")})`)
          .join("; ");
        if (viewText) {
          row.createSpan({
            cls: "flint-chat-tool-list-meta",
            text: viewText,
          });
        }

        // Context badge.
        if (base.requiresContext) {
          row.createSpan({
            cls: "flint-chat-tool-list-badge is-context",
            text: "ctx",
          });
        }

        // Validation errors.
        if (base.validationErrors.length > 0) {
          row.createSpan({
            cls: "flint-chat-tool-list-badge is-error",
            text: `${base.validationErrors.length} err`,
          });
        }
      }
    },

    renderMarkdown(_args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error**\n\n${codeBlock(msg, "text")}`;
      }

      const details = result.details as
        | { bases?: Array<BaseSummary | BaseError> }
        | undefined;
      const bases = details?.bases;
      if (!bases?.length) return "_No Bases found._";

      const lines = bases.map((base) => {
        if ("error" in base)
          return `- \`${base.path}\` — _parse error: ${base.error}_`;
        const viewParts = base.views
          .map(
            (v) =>
              `\`${v.name}\` (${v.type}: ${v.columns.map((c) => `\`${c}\``).join(", ")})`,
          )
          .join("; ");
        const ctx = base.requiresContext ? " _requires context_" : "";
        const errs = base.validationErrors.length
          ? ` (${base.validationErrors.length} error(s))`
          : "";
        return `- \`${base.path}\` — ${viewParts}${ctx}${errs}`;
      });
      return `**${bases.length} Base${bases.length === 1 ? "" : "s"}**\n\n${lines.join("\n")}`;
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
