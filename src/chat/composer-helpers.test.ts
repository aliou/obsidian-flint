import type { MetadataCache, TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  buildWikiLinkSuggestions,
  expandResolvedWikiLinks,
} from "./composer-helpers";

function file(path: string): TFile {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  return { path, name, extension, basename } as TFile;
}

function vaultWithFiles(files: TFile[]): Vault {
  return { getFiles: () => files } as unknown as Vault;
}

describe("buildWikiLinkSuggestions", () => {
  it("uses Obsidian linktext for insertion targets", () => {
    const notes = [file("Archive/Foo.md"), file("Projects/Foo.md")];
    const metadataCache = {
      fileToLinktext: vi.fn((note: TFile) => note.path.replace(/\.md$/u, "")),
    } as unknown as MetadataCache;

    const suggestions = buildWikiLinkSuggestions(
      vaultWithFiles(notes),
      metadataCache,
      "foo",
    );

    expect(suggestions.map((suggestion) => suggestion.target)).toEqual([
      "Archive/Foo",
      "Projects/Foo",
    ]);
    expect(metadataCache.fileToLinktext).toHaveBeenCalledWith(
      notes[0],
      "",
      true,
    );
    expect(metadataCache.fileToLinktext).toHaveBeenCalledWith(
      notes[1],
      "",
      true,
    );
  });
});

describe("expandResolvedWikiLinks", () => {
  it("resolves path-qualified wikilinks independently", () => {
    const resolved = new Map([
      ["Archive/Foo", "/Archive/Foo.md"],
      ["Projects/Foo", "/Projects/Foo.md"],
    ]);

    expect(
      expandResolvedWikiLinks(
        "Compare [[Archive/Foo]] and [[Projects/Foo]]",
        resolved,
      ),
    ).toBe(
      'Compare <obsidian-wikilink path="/Archive/Foo.md">Archive/Foo</obsidian-wikilink> and <obsidian-wikilink path="/Projects/Foo.md">Projects/Foo</obsidian-wikilink>',
    );
  });
});
