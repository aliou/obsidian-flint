/**
 * Truncation helpers matching Pi coding-agent defaults.
 *
 * - Default max lines: 2000
 * - Default max bytes: 50KB
 * - `offset` is 1-indexed
 * - Continuation notices in square brackets
 */

const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).byteLength;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  outputLines: number;
  totalLines: number;
  firstLineExceedsLimit: boolean;
  startLine: number; // 1-indexed
}

/**
 * Truncate an array of lines starting from `offset` (1-indexed),
 * respecting both line and byte limits.
 *
 * The returned content does NOT include line numbers.
 * The caller can add them if needed.
 */
export function truncateLines(
  allLines: string[],
  options?: {
    offset?: number; // 1-indexed, default 1
    limit?: number; // max lines from user, default no user limit
    maxLines?: number; // internal cap, default 2000
    maxBytes?: number; // internal cap, default 50KB
  },
): TruncationResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const offset = options?.offset ?? 1;
  const startLine = Math.max(1, offset); // 1-indexed
  const startIdx = startLine - 1; // 0-indexed
  const totalLines = allLines.length;

  if (startIdx >= totalLines) {
    return {
      content: "",
      truncated: false,
      truncatedBy: null,
      outputLines: 0,
      totalLines,
      firstLineExceedsLimit: false,
      startLine,
    };
  }

  // Determine the effective line cap.
  let effectiveMaxLines = maxLines;
  let userLimited = false;
  if (options?.limit !== undefined && options.limit > 0) {
    effectiveMaxLines = Math.min(maxLines, options.limit);
    userLimited = true;
  }

  const selected = allLines.slice(startIdx);

  // Check if first line exceeds byte limit.
  const firstLine = selected[0];
  if (firstLine !== undefined && byteLength(firstLine) > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      outputLines: 0,
      totalLines,
      firstLineExceedsLimit: true,
      startLine,
    };
  }

  // Accumulate lines up to limits.
  const out: string[] = [];
  let bytes = 0;
  let truncatedBy: "lines" | "bytes" | null = null;
  let hitLimit = false;

  for (let i = 0; i < selected.length && i < effectiveMaxLines; i++) {
    const line = selected[i];
    if (line === undefined) break;
    const lineBytes = byteLength(line) + (i > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      hitLimit = true;
      break;
    }
    out.push(line);
    bytes += lineBytes;
  }

  const outputLines = out.length;
  const endLine = startLine + outputLines - 1;
  const remaining = totalLines - startIdx - outputLines;

  if (!hitLimit && out.length >= effectiveMaxLines && remaining > 0) {
    truncatedBy = "lines";
    hitLimit = true;
  }

  if (!hitLimit) {
    truncatedBy = null;
  }

  // If user explicitly limited and we returned exactly their limit, note it.

  let content = out.join("\n");

  if (outputLines === 0 && totalLines > startIdx) {
    // First line exceeded limit.
    const firstLine = allLines[startIdx];
    const lineSize = formatSize(byteLength(firstLine ?? ""));
    content = `[Line ${startLine} is ${lineSize}, exceeds ${formatSize(maxBytes)} limit.]`;
  } else if (hitLimit && outputLines > 0) {
    const limitNote =
      truncatedBy === "bytes" ? ` (${formatSize(maxBytes)} limit)` : "";
    const nextOffset = endLine + 1;
    content = `${content}\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}${limitNote}. Use offset=${nextOffset} to continue.]`;
  } else if (userLimited && remaining > 0) {
    const nextOffset = endLine + 1;
    content = `${content}\n\n[${remaining} more lines. Use offset=${nextOffset} to continue.]`;
  }

  return {
    content,
    truncated: hitLimit,
    truncatedBy,
    outputLines,
    totalLines,
    firstLineExceedsLimit: outputLines === 0 && totalLines > startIdx,
    startLine,
  };
}

/** Truncate a single long line, returning the truncated text and a flag. */
export function truncateLine(
  line: string,
  maxChars = 500,
): { text: string; truncated: boolean } {
  if (line.length <= maxChars) return { text: line, truncated: false };
  return { text: `${line.slice(0, maxChars)}`, truncated: true };
}
