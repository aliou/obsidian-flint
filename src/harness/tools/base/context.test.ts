import type { BaseDefinition } from "@aliou/obsdx-base-ast";
import { assert, describe, expect, it } from "vitest";
import { baseRequiresContext, contextRequiredMessage } from "./context";

function makeBase(overrides: Partial<BaseDefinition> = {}): BaseDefinition {
  return {
    path: "test.base",
    source: {},
    properties: {},
    formulas: {},
    views: [],
    ...overrides,
  };
}

describe("baseRequiresContext", () => {
  it("returns false when no `this` references exist", () => {
    const base = makeBase({
      formulas: { total: "count(file.name)" },
      filters: 'status == "active"',
      views: [
        {
          type: "table",
          name: "Active",
          filters: 'priority == "high"',
          order: ["file.name"],
          sort: [],
          raw: {},
        },
      ],
    });
    const result = baseRequiresContext(base);
    expect(result.requiresContext).toBe(false);
  });

  it("detects `this` in formulas", () => {
    const base = makeBase({
      formulas: { links: "list(this.file.links)" },
    });
    const result = baseRequiresContext(base);
    expect(result.requiresContext).toBe(true);
    expect(result.reasons).toHaveLength(1);
    assert(result.reasons[0], "reason should exist");
    expect(result.reasons[0].scope).toBe("formula");
  });

  it("detects `this` in base-level filters", () => {
    const base = makeBase({
      filters: 'this.file.name == "current"',
    });
    const result = baseRequiresContext(base);
    expect(result.requiresContext).toBe(true);
  });

  it("detects `this` in view-level filters", () => {
    const base = makeBase({
      views: [
        {
          type: "table",
          name: "Related",
          filters: "this.file.folder == file.folder",
          order: ["file.name"],
          sort: [],
          raw: {},
        },
      ],
    });
    const result = baseRequiresContext(base);
    expect(result.requiresContext).toBe(true);
    assert(result.reasons[0], "reason should exist");
    expect(result.reasons[0].scope).toBe("view-filter");
  });

  it("scopes to specific view when viewName provided", () => {
    const base = makeBase({
      views: [
        {
          type: "table",
          name: "NoCtx",
          filters: 'status == "active"',
          order: ["file.name"],
          sort: [],
          raw: {},
        },
        {
          type: "table",
          name: "NeedsCtx",
          filters: "this.file.name == file.name",
          order: ["file.name"],
          sort: [],
          raw: {},
        },
      ],
    });
    // No view specified: should detect `this` across all views.
    expect(baseRequiresContext(base).requiresContext).toBe(true);
    // Specific view without `this`: should not require context.
    expect(baseRequiresContext(base, "NoCtx").requiresContext).toBe(false);
    // Specific view with `this`: should require context.
    expect(baseRequiresContext(base, "NeedsCtx").requiresContext).toBe(true);
  });

  it("handles filter objects with and/or/not", () => {
    const base = makeBase({
      filters: {
        op: "and",
        children: [
          { op: "expr", expression: 'status == "active"' },
          { op: "expr", expression: "this.file.name == file.name" },
        ],
      },
    });
    const result = baseRequiresContext(base);
    expect(result.requiresContext).toBe(true);
  });
});

describe("contextRequiredMessage", () => {
  it("returns empty string when no context required", () => {
    const base = makeBase();
    expect(contextRequiredMessage(base as never)).toBe("");
  });

  it("returns helpful message with context required", () => {
    const base = makeBase({
      formulas: { links: "list(this.file.links)" },
    });
    const msg = contextRequiredMessage(base as never);
    expect(msg).toContain("Context file required");
    expect(msg).toContain("formula");
    expect(msg).toContain("context=");
  });
});
