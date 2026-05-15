import type { BaseFileInspection } from "@aliou/obsdx-base-engine";
import type { App, CachedMetadata, TFile } from "obsidian";

function metadataFor(app: App, file: TFile): CachedMetadata | undefined {
  return app.metadataCache.getFileCache(file) ?? undefined;
}

function frontmatterProperties(cache: CachedMetadata | undefined) {
  const frontmatter = cache?.frontmatter ?? {};
  return Object.entries(frontmatter)
    .filter(([name]) => name !== "position")
    .map(([name, value]) => ({
      name,
      value,
      valueType: Array.isArray(value) ? "list" : typeof value,
    }));
}

function tagsFor(cache: CachedMetadata | undefined): Array<{ tag: string }> {
  const tags = new Set<string>();
  for (const tag of cache?.tags ?? []) tags.add(tag.tag.replace(/^#/, ""));
  const fmTags = cache?.frontmatter?.tags;
  if (typeof fmTags === "string") tags.add(fmTags.replace(/^#/, ""));
  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) {
      if (typeof tag === "string") tags.add(tag.replace(/^#/, ""));
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag }));
}

function backlinksFor(app: App, file: TFile): Array<{ resolvedPath: string }> {
  return Object.entries(app.metadataCache.resolvedLinks)
    .filter(([, targets]) => targets[file.path])
    .map(([source]) => ({ resolvedPath: source }));
}

export function inspectMarkdownFile(app: App, file: TFile): BaseFileInspection {
  const cache = metadataFor(app, file);
  return {
    file: {
      path: file.path,
      name: file.name,
      basename: file.basename,
      ext: file.extension,
      folder: file.parent?.path ?? "",
      kind: "markdown",
      ctime: new Date(file.stat.ctime).toISOString(),
      mtime: new Date(file.stat.mtime).toISOString(),
      size: file.stat.size,
      indexedAt: new Date().toISOString(),
      parseError: null,
    },
    properties: frontmatterProperties(cache),
    tags: tagsFor(cache),
    links: (cache?.links ?? []).map((link) => ({
      resolvedPath:
        app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path ??
        null,
      targetText: link.link,
    })),
    backlinks: backlinksFor(app, file),
    embeds: (cache?.embeds ?? []).map((embed) => ({
      resolvedPath:
        app.metadataCache.getFirstLinkpathDest(embed.link, file.path)?.path ??
        null,
      targetText: embed.link,
    })),
  };
}
