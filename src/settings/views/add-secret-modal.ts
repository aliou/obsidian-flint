import { type App, Modal, Notice } from "obsidian";

export class AddSecretModal extends Modal {
  private secretId = "";
  private secretValue = "";

  constructor(
    app: App,
    private readonly onSaved: (secretId: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Add secret");
    this.modalEl.addClass("flint-add-secret-modal");

    const idInput = this.contentEl.createEl("input", {
      type: "text",
      placeholder: "flint-my-provider-api-key",
    });
    idInput.addEventListener("input", (e) => {
      this.secretId = (e.target as HTMLInputElement).value;
    });

    const valueInput = this.contentEl.createEl("input", {
      type: "password",
      placeholder: "Secret value",
    });
    valueInput.addEventListener("input", (e) => {
      this.secretValue = (e.target as HTMLInputElement).value;
    });

    const actions = this.contentEl.createDiv("modal-button-container");
    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", {
      text: "Save",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => this.save());
  }

  private save(): void {
    const id = this.secretId.trim();
    const value = this.secretValue.trim();
    if (!id) {
      new Notice("Secret id is required");
      return;
    }
    if (!value) {
      new Notice("Secret value is required");
      return;
    }
    this.app.secretStorage.setSecret(id, value);
    new Notice(`Saved secret: ${id}`);
    this.onSaved(id);
    this.close();
  }
}
