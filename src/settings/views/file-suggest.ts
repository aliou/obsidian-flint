import { AbstractInputSuggest, type App, TFile } from "obsidian";

export class FileSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    textInputEl: HTMLInputElement,
    private readonly onSelectPath: (path: string) => void,
  ) {
    super(app, textInputEl);
    this.onSelect((value) => {
      this.onSelectPath(value);
    });
  }

  protected getSuggestions(query: string): string[] {
    const normalizedQuery = query.toLowerCase().trim();
    return this.app.vault
      .getFiles()
      .map((file) => file.path)
      .filter((path) => path.toLowerCase().includes(normalizedQuery));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    const file = this.app.vault.getAbstractFileByPath(value);
    el.setText(file instanceof TFile ? value : "");
  }

  selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.onSelectPath(value);
    this.close();
  }
}
