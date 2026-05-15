import { AbstractInputSuggest, type App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    textInputEl: HTMLInputElement,
    private readonly onSelectPath: (path: string) => void,
    private readonly filter?: (folder: TFolder) => boolean,
  ) {
    super(app, textInputEl);
    this.onSelect((value) => {
      this.onSelectPath(value);
    });
  }

  protected getSuggestions(query: string): string[] {
    const folders = this.app.vault.getAllFolders();
    const normalizedQuery = query.toLowerCase().trim();
    return folders
      .filter((folder) => this.filter?.(folder) ?? true)
      .map((folder) => folder.path)
      .filter((path) => path.toLowerCase().includes(normalizedQuery));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    const folder = this.app.vault.getAbstractFileByPath(value);
    const isRoot = folder instanceof TFolder && folder.isRoot();
    el.setText(isRoot ? "/" : value);
  }

  selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.onSelectPath(value);
    this.close();
  }
}
