import { queryBase } from "@aliou/obsdx-base-engine";
import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import { Type } from "typebox";
import { validateToolPath } from "../guardrails";
import type { ObsidianTool } from "../types";
import { errorText, pathDisplayName, text, vaultPathToEnvPath } from "../utils";
import { contextRequiredMessage } from "./context";
import { markdownInspections, parseBaseFile } from "./utils";

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const MAX_VISIBLE_COLUMNS = 12;

const parameters = Type.Object({
  path: Type.String({
    description:
      "Vault-relative path of the .base file to query, such as /Bases/Tasks.base.",
  }),
  view: Type.Optional(
    Type.String({
      description:
        "Optional Base view name to execute. Omit to use the Base default view.",
    }),
  ),
  context: Type.Optional(
    Type.String({
      description:
        "Optional vault-relative context file path used for Base formulas that depend on the current file.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      default: DEFAULT_QUERY_LIMIT,
      description: `Maximum number of rows to return. Default ${DEFAULT_QUERY_LIMIT}, max ${MAX_QUERY_LIMIT}.`,
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      default: 1,
      description:
        "1-indexed row offset. Use offset=51 to continue from the 51st row.",
    }),
  ),
});

export const queryBaseToolDefinition = {
  name: "query_base",
  label: "Query Base",
  description:
    "Execute a Base query against the current Obsidian metadata cache using the obsdx Bases engine.",
  promptGuidelines: [
    "Use query_base when the user asks to run, execute, or evaluate a Base.",
    "Prefer query_base over manually interpreting Bases when the user asks for returned rows.",
    "query_base results are visible to the user in the tool output, so do not repeat the rows in your reply. Summarize or interpret instead.",
  ],
} as const;

interface QueryBaseDetails {
  path: string;
  view?: string;
  context?: string;
  columns: Array<{ id: string; displayName: string; type: string }>;
  rows: Array<{ file: { path: string }; data: Record<string, unknown> }>;
  totalRows: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
  groups: unknown[];
  summaries: Record<string, unknown>;
  meta: unknown;
}

export function createQueryBaseTool(
  env: ExecutionEnv,
  app: App,
): ObsidianTool<typeof parameters> {
  return {
    ...queryBaseToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const basePath = validateToolPath(params.path);
      if (!basePath.ok) return errorText(basePath.error);
      const contextPath = params.context
        ? validateToolPath(params.context)
        : undefined;
      if (contextPath && !contextPath.ok) return errorText(contextPath.error);

      if (contextPath?.ok) {
        const contextInfo = await env.fileInfo(contextPath.envPath);
        if (!contextInfo.ok) return errorText(contextInfo.error.message);
        if (contextInfo.value.kind !== "file") {
          return errorText(
            `Context path is not a file: ${contextPath.displayPath}`,
          );
        }
      }

      const parsed = await parseBaseFile(env, basePath.envPath);
      if (!parsed.ok)
        return errorText(parsed.error, { path: basePath.envPath });

      // Check if context is required but not provided.
      const contextMsg = contextRequiredMessage(
        parsed.base as never,
        params.view,
      );
      if (contextMsg && !params.context) {
        return errorText(contextMsg, {
          path: basePath.envPath,
          view: params.view,
        });
      }

      const inspections = await markdownInspections(env, app);
      if (!inspections.ok) return errorText(inspections.error);

      try {
        const result = queryBase(parsed.base, inspections.inspections, {
          view: params.view,
          context: contextPath?.ok ? contextPath.vaultPath : undefined,
        });

        const limit = Math.max(
          1,
          Math.min(params.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT),
        );
        const offset = Math.max(1, params.offset ?? 1);
        const sliceStart = offset - 1;
        const allRows = result.rows;
        const totalRows = allRows.length;
        const rows = allRows.slice(sliceStart, sliceStart + limit);
        const hasMore = sliceStart + limit < totalRows;
        const nextOffset = hasMore ? sliceStart + limit + 1 : undefined;

        // Build content with pipe-separated rows.
        const columns = result.columns;
        const visibleColumns =
          columns.length > MAX_VISIBLE_COLUMNS
            ? columns.slice(0, MAX_VISIBLE_COLUMNS)
            : columns;

        // Header row.
        const headerParts = [
          "file",
          ...visibleColumns.map((c) => c.displayName || c.id),
        ];
        const header = headerParts.join(" | ");

        // Data rows.
        const dataRows = rows.map((row) => {
          const file = vaultPathToEnvPath(row.file.path).replace(/^\//, "");
          const cells = [file];
          for (const col of visibleColumns) {
            const val = row.data[col.id];
            cells.push(
              val === undefined
                ? ""
                : typeof val === "string"
                  ? val
                  : JSON.stringify(val),
            );
          }
          return cells.join(" | ");
        });

        let content = [header, ...dataRows].join("\n");

        // Column limit notice.
        if (columns.length > MAX_VISIBLE_COLUMNS) {
          content += `\n[Showing ${MAX_VISIBLE_COLUMNS} of ${columns.length} columns. Use read on the Base to inspect all columns.]`;
        }

        // Row continuation notice.
        if (hasMore) {
          content += `\n[Showing rows ${offset}-${offset + rows.length - 1} of ${totalRows}. Use offset=${nextOffset} to continue.]`;
        }

        if (rows.length === 0) {
          content = "(no matching rows)";
        }

        return text(content, {
          path: basePath.envPath,
          view: params.view,
          context: contextPath?.ok ? contextPath.envPath : undefined,
          columns: result.columns,
          rows,
          totalRows,
          offset,
          limit,
          hasMore,
          nextOffset,
          groups: result.groups,
          summaries: result.summaries,
          meta: result.meta,
        } satisfies QueryBaseDetails);
      } catch (error) {
        return errorText(
          error instanceof Error ? error.message : String(error),
          {
            path: basePath.envPath,
            view: params.view,
          },
        );
      }
    },

    renderTitle(label, args) {
      const parts = [`${label}: \`${pathDisplayName(args.path)}\``];
      if (args.view) parts.push(`→ ${args.view}`);
      return parts.join(" ");
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Querying…",
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

      const details = result.details as QueryBaseDetails | undefined;
      const rows = details?.rows;
      if (!rows?.length) {
        el.createDiv({
          cls: "flint-chat-tool-section",
          text: "No matching rows",
        });
        return;
      }

      const section = el.createDiv("flint-chat-tool-section");

      const columns = details?.columns ?? [];
      const visibleColumns = columns.slice(0, ctx.isMobile ? 4 : 8);
      const keys = visibleColumns.map((c) => c.id);

      const table = section.createEl("table", { cls: "flint-chat-tool-table" });
      const thead = table.createEl("thead");
      const headRow = thead.createEl("tr");
      headRow.createEl("th", { text: "File" });
      for (const col of visibleColumns) {
        headRow.createEl("th", { text: col.displayName || col.id });
      }

      const tbody = table.createEl("tbody");
      const maxRenderRows = ctx.isMobile ? 10 : 25;
      for (const row of rows.slice(0, maxRenderRows)) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", {
          text: vaultPathToEnvPath(row.file.path),
        });
        for (const key of keys) {
          const val = row.data?.[key];
          tr.createEl("td", {
            text:
              val === undefined
                ? ""
                : typeof val === "string"
                  ? val
                  : JSON.stringify(val),
          });
        }
      }
    },

    renderMarkdown(args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error querying ${args.path}**\n\n${codeBlock(msg, "text")}`;
      }

      const details = result.details as QueryBaseDetails | undefined;
      const rows = details?.rows;
      if (!rows?.length) return "_No matching rows._";

      const columns = details?.columns ?? [];
      const visibleColumns = columns.slice(0, 8);
      const keys = visibleColumns.map((c) => c.displayName || c.id);

      const header = `| File | ${keys.join(" | ")} |`;
      const sep = `| --- | ${keys.map(() => "---").join(" | ")} |`;
      const body = rows.slice(0, 50).map((row) => {
        const file = vaultPathToEnvPath(row.file.path);
        const cells = keys.map((k) => {
          const col = columns.find((c) => (c.displayName || c.id) === k);
          const id = col?.id ?? k;
          const v = row.data?.[id];
          return v === undefined
            ? ""
            : String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
        });
        return `| ${file} | ${cells.join(" | ")} |`;
      });

      return `${header}\n${sep}\n${body.join("\n")}`;
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
