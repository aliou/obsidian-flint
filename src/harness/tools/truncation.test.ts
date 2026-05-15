import { describe, expect, it } from "vitest";
import { truncateLine, truncateLines } from "./truncation";

describe("truncateLines", () => {
  it("returns full content when within limits", () => {
    const lines = ["line 1", "line 2", "line 3"];
    const result = truncateLines(lines);
    expect(result.content).toBe("line 1\nline 2\nline 3");
    expect(result.truncated).toBe(false);
    expect(result.outputLines).toBe(3);
    expect(result.totalLines).toBe(3);
  });

  it("respects user limit", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
    const result = truncateLines(lines, { limit: 2 });
    expect(result.outputLines).toBe(2);
    expect(result.content).toContain("line 1");
    expect(result.content).toContain("line 2");
    expect(result.content).toContain("Showing lines 1-2 of 5");
  });

  it("respects offset (1-indexed)", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
    const result = truncateLines(lines, { offset: 3 });
    expect(result.startLine).toBe(3);
    expect(result.content).toContain("line 3");
    expect(result.content).not.toContain("line 1");
    expect(result.content).not.toContain("line 2");
  });

  it("handles offset beyond file", () => {
    const lines = ["line 1", "line 2"];
    const result = truncateLines(lines, { offset: 10 });
    expect(result.content).toBe("");
    expect(result.outputLines).toBe(0);
  });

  it("adds continuation notice when truncated by max lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const result = truncateLines(lines, { maxLines: 10 });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("[Showing lines 1-10 of 100");
    expect(result.content).toContain("offset=11");
  });

  it("adds continuation notice with user limit", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const result = truncateLines(lines, { limit: 5 });
    expect(result.content).toContain("[Showing lines 1-5 of 100");
    expect(result.content).toContain("offset=6");
  });

  it("does not mark exact max line count as truncated", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const result = truncateLines(lines, { maxLines: 10 });
    expect(result.truncated).toBe(false);
    expect(result.content).not.toContain("Use offset=");
  });

  it("does not mark exact user limit as truncated when no lines remain", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
    const result = truncateLines(lines, { limit: 5 });
    expect(result.truncated).toBe(false);
    expect(result.content).not.toContain("Use offset=");
  });
});

describe("truncateLine", () => {
  it("returns line as-is when under limit", () => {
    const result = truncateLine("short line", 100);
    expect(result.text).toBe("short line");
    expect(result.truncated).toBe(false);
  });

  it("truncates long lines", () => {
    const longLine = "a".repeat(600);
    const result = truncateLine(longLine, 500);
    expect(result.text.length).toBe(500);
    expect(result.truncated).toBe(true);
  });
});
