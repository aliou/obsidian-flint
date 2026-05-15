/**
 * Detect whether a Base requires a context file because it uses `this`.
 *
 * Checks:
 * - `base.formulas` expressions
 * - `base.filters` expressions
 * - View-level `filters` expressions
 * - View-level `summaries` expressions
 *
 * First pass uses string scan `\bthis\b`.
 * Better pass parses expressions and inspects AST for `{ kind: "identifier", name: "this" }`.
 */

import { type BaseDefinition, parseExpression } from "@aliou/obsdx-base-ast";

export interface ContextRequirementReason {
  scope: "formula" | "filter" | "view-filter" | "view-summary";
  name?: string;
  view?: string;
}

export interface ContextRequirement {
  requiresContext: boolean;
  reasons: ContextRequirementReason[];
}

/**
 * Quick string scan for `\bthis\b` in expression strings.
 * This is the first-pass check; the AST-based check is more precise.
 */
function containsThisString(source: string): boolean {
  return /\bthis\b/.test(source);
}

/**
 * AST-based check for `this` identifier in an expression string.
 * Falls back to string scan if parsing fails.
 */
function containsThisAst(source: string): boolean {
  try {
    const expr = parseExpression(source);
    return hasThisIdentifier(expr);
  } catch {
    return containsThisString(source);
  }
}

/** Recursively inspect AST for `{ kind: "identifier", name: "this" }`. */
function hasThisIdentifier(expr: unknown): boolean {
  if (expr === null || expr === undefined || typeof expr !== "object") {
    return false;
  }
  const e = expr as Record<string, unknown>;
  if (e.kind === "identifier" && e.name === "this") return true;

  // Recurse into known AST node children.
  for (const value of Object.values(e)) {
    if (Array.isArray(value)) {
      if (value.some((item) => hasThisIdentifier(item))) return true;
    } else if (typeof value === "object" && value !== null) {
      if (hasThisIdentifier(value)) return true;
    }
  }
  return false;
}

/**
 * Check filter structures for `this`.
 * Filters can be: string expressions, { and: [...] }, { or: [...] }, { not: [...] }
 */
function filterContainsThis(filter: unknown): boolean {
  if (typeof filter === "string") return containsThisAst(filter);
  if (filter === null || filter === undefined) return false;
  if (typeof filter !== "object") return false;
  const f = filter as Record<string, unknown>;

  if (f.op === "expr" && typeof f.expression === "string") {
    return containsThisAst(f.expression);
  }
  if (
    (f.op === "and" || f.op === "or" || f.op === "not") &&
    Array.isArray(f.children)
  ) {
    return f.children.some((child: unknown) => filterContainsThis(child));
  }
  // Unknown filter object — check all string values.
  for (const value of Object.values(f)) {
    if (typeof value === "string" && containsThisString(value)) return true;
    if (typeof value === "object" && value !== null) {
      if (filterContainsThis(value)) return true;
    }
  }
  return false;
}

/**
 * Check if summaries record contains `this`.
 * Summaries values are typically expression strings.
 */
function summariesContainThis(
  summaries: Record<string, unknown> | undefined,
): boolean {
  if (!summaries) return false;
  return Object.entries(summaries).some(([, value]) => {
    if (typeof value === "string") return containsThisString(value);
    return false;
  });
}

/** Determine whether a Base (or specific view) requires context. */
export function baseRequiresContext(
  base: BaseDefinition,
  viewName?: string,
): ContextRequirement {
  const reasons: ContextRequirementReason[] = [];

  // Check base-level formulas.
  for (const [name, expr] of Object.entries(base.formulas)) {
    if (typeof expr === "string" && containsThisAst(expr)) {
      reasons.push({ scope: "formula", name });
    }
  }

  // Check base-level filters.
  if (base.filters && filterContainsThis(base.filters)) {
    reasons.push({ scope: "filter" });
  }

  // Check base-level summaries.
  if (summariesContainThis(base.summaries)) {
    reasons.push({ scope: "view-summary" });
  }

  // Check views.
  const viewsToCheck = viewName
    ? base.views.filter((v) => v.name === viewName)
    : base.views;

  for (const view of viewsToCheck) {
    if (view.filters && filterContainsThis(view.filters)) {
      reasons.push({ scope: "view-filter", view: view.name });
    }
    if (
      summariesContainThis(
        view.summaries as Record<string, unknown> | undefined,
      )
    ) {
      reasons.push({ scope: "view-summary", view: view.name });
    }
  }

  return {
    requiresContext: reasons.length > 0,
    reasons,
  };
}

/** Format a context-required error message for the agent. */
export function contextRequiredMessage(
  base: BaseDefinition,
  viewName?: string,
): string {
  const req = baseRequiresContext(base, viewName);
  if (!req.requiresContext) return "";

  const detailParts = req.reasons.map((r) => {
    switch (r.scope) {
      case "formula":
        return `formula "${r.name}"`;
      case "filter":
        return "base filter";
      case "view-filter":
        return `view "${r.view}" filter`;
      case "view-summary":
        return r.view ? `view "${r.view}" summary` : "base summary";
      default:
        return r.scope;
    }
  });
  const detail = detailParts.join(", ");
  return `Context file required for this Base because it uses \`this\` in: ${detail}. Re-run with context=/path/to/current-note.md`;
}
