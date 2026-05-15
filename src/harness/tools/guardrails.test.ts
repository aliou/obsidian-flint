import { assert, describe, expect, it } from "vitest";
import {
  filterVisibleEntries,
  filterVisibleFiles,
  inferPropertyType,
  isBlockedVaultPath,
  isTextReadable,
  kindForFile,
  matchGlob,
  matchVaultPattern,
  normalizeVaultToolPath,
  validateToolPath,
} from "./guardrails";

describe("isBlockedVaultPath", () => {
  it("blocks .obsidian and children", () => {
    expect(isBlockedVaultPath("/.obsidian")).toBe(true);
    expect(isBlockedVaultPath("/.obsidian/types.json")).toBe(true);
    expect(isBlockedVaultPath("/.obsidian/plugins")).toBe(true);
  });

  it("blocks .pi and children", () => {
    expect(isBlockedVaultPath("/.pi")).toBe(true);
    expect(isBlockedVaultPath("/.pi/sessions")).toBe(true);
  });

  it("blocks .DS_Store", () => {
    expect(isBlockedVaultPath("/.DS_Store")).toBe(true);
  });

  it("blocks any dot-prefixed segment", () => {
    expect(isBlockedVaultPath("/.trash")).toBe(true);
    expect(isBlockedVaultPath("/.smart-env")).toBe(true);
    expect(isBlockedVaultPath("/Notes/.hidden")).toBe(true);
  });

  it("allows normal paths", () => {
    expect(isBlockedVaultPath("/")).toBe(false);
    expect(isBlockedVaultPath("")).toBe(false);
    expect(isBlockedVaultPath("/Notes/Alpha.md")).toBe(false);
    expect(isBlockedVaultPath("/bases/test.base")).toBe(false);
  });
});

describe("normalizeVaultToolPath", () => {
  it("handles paths with and without leading slash", () => {
    expect(normalizeVaultToolPath("Notes/Alpha.md").envPath).toBe(
      "/Notes/Alpha.md",
    );
    expect(normalizeVaultToolPath("/Notes/Alpha.md").envPath).toBe(
      "/Notes/Alpha.md",
    );
  });

  it("handles root path", () => {
    expect(normalizeVaultToolPath("/").envPath).toBe("/");
    expect(normalizeVaultToolPath("").envPath).toBe("/");
  });

  it("rejects path traversal", () => {
    expect(() => normalizeVaultToolPath("../../etc/passwd")).toThrow(
      "Path traversal",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeVaultToolPath("/Notes/").envPath).toBe("/Notes");
  });
});

describe("validateToolPath", () => {
  it("returns ok for valid paths", () => {
    const result = validateToolPath("/Notes/Alpha.md");
    expect(result.ok).toBe(true);
    assert(result.ok, "result should be ok");
    expect(result.envPath).toBe("/Notes/Alpha.md");
    expect(result.vaultPath).toBe("Notes/Alpha.md");
    expect(result.displayPath).toBe("Notes/Alpha.md");
  });

  it("returns error for blocked paths", () => {
    const result = validateToolPath("/.obsidian/types.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not accessible");
    }
  });

  it("returns error for traversal", () => {
    const result = validateToolPath("../secret");
    expect(result.ok).toBe(false);
  });
});

describe("matchGlob", () => {
  it("does substring match when no glob metacharacters", () => {
    expect(matchGlob("Alpha", "Notes/Alpha.md")).toBe(true);
    expect(matchGlob("Bravo", "Notes/Alpha.md")).toBe(false);
  });

  it("matches * within a segment", () => {
    expect(matchGlob("*.md", "Alpha.md")).toBe(true);
    expect(matchGlob("*.md", "Notes/Alpha.md")).toBe(false);
    expect(matchGlob("*.base", "test.base")).toBe(true);
  });

  it("matches ** across segments", () => {
    expect(matchGlob("**/*.md", "Notes/Alpha.md")).toBe(true);
    expect(matchGlob("**/*.md", "Notes/deep/file.md")).toBe(true);
    expect(matchGlob("**/*.md", "bases/test.base")).toBe(false);
  });

  it("matches ? for single character", () => {
    expect(matchGlob("Alpha?.md", "Alpha1.md")).toBe(true);
    expect(matchGlob("Alpha?.md", "Alpha12.md")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchGlob("ALPHA", "alpha")).toBe(true);
    expect(matchGlob("*.MD", "Alpha.md")).toBe(true);
  });
});

describe("matchVaultPattern", () => {
  it("matches basename globs recursively", () => {
    expect(matchVaultPattern("*.md", "Notes/Alpha.md")).toBe(true);
    expect(matchVaultPattern("*.base", "bases/t01_filename.base")).toBe(true);
    expect(matchVaultPattern("*.md", "bases/t01_filename.base")).toBe(false);
  });

  it("matches path-aware globs against relative paths", () => {
    expect(matchVaultPattern("Notes/*.md", "Notes/Alpha.md")).toBe(true);
    expect(matchVaultPattern("**/*.md", "Notes/Deep/Alpha.md")).toBe(true);
    expect(matchVaultPattern("Projects/*.md", "Notes/Alpha.md")).toBe(false);
  });
});

describe("kindForFile", () => {
  it("returns folder for directories", () => {
    expect(kindForFile({ kind: "directory", name: "Notes" })).toBe("folder");
  });

  it("returns note for .md files", () => {
    expect(kindForFile({ kind: "file", name: "Alpha.md" })).toBe("note");
  });

  it("returns base for .base files", () => {
    expect(kindForFile({ kind: "file", name: "test.base" })).toBe("base");
  });

  it("returns file for other extensions", () => {
    expect(kindForFile({ kind: "file", name: "image.png" })).toBe("file");
  });
});

describe("isTextReadable", () => {
  it("returns true for text extensions", () => {
    expect(isTextReadable("file.md")).toBe(true);
    expect(isTextReadable("file.base")).toBe(true);
    expect(isTextReadable("file.json")).toBe(true);
    expect(isTextReadable("file.csv")).toBe(true);
    expect(isTextReadable("file.txt")).toBe(true);
  });

  it("returns false for binary extensions", () => {
    expect(isTextReadable("image.png")).toBe(false);
    expect(isTextReadable("image.jpg")).toBe(false);
    expect(isTextReadable("file.pdf")).toBe(false);
  });
});

describe("inferPropertyType", () => {
  it("infers list from arrays", () => {
    expect(inferPropertyType(["a", "b"])).toBe("list");
  });

  it("infers text from strings", () => {
    expect(inferPropertyType("hello")).toBe("text");
  });

  it("infers date from date-like strings", () => {
    expect(inferPropertyType("2026-05-18")).toBe("date");
    expect(inferPropertyType("2026-05-18T10:30:00")).toBe("date");
  });

  it("infers number from numbers", () => {
    expect(inferPropertyType(42)).toBe("number");
  });

  it("infers checkbox from booleans", () => {
    expect(inferPropertyType(true)).toBe("checkbox");
  });
});

describe("filterVisibleFiles/filterVisibleEntries", () => {
  const files = [
    { name: "Alpha.md", path: "/Notes/Alpha.md" },
    { name: "types.json", path: "/.obsidian/types.json" },
    { name: "session.jsonl", path: "/.pi/sessions/s1.jsonl" },
    { name: "notes.md", path: "/Notes/notes.md" },
  ];

  it("removes blocked paths", () => {
    const visible = filterVisibleFiles(files);
    expect(visible).toHaveLength(2);
    expect(visible.map((f) => f.path)).toEqual([
      "/Notes/Alpha.md",
      "/Notes/notes.md",
    ]);
  });

  it("filterVisibleEntries works the same way", () => {
    const visible = filterVisibleEntries(files);
    expect(visible).toHaveLength(2);
  });
});
