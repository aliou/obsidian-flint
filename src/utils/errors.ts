import { Notice } from "obsidian";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function noticeError(error: unknown): void {
  console.error(error);
  new Notice(errorMessage(error));
}
