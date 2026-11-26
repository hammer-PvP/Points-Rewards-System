import { MODULE_ID } from "../constants.mjs";

const BASE = `modules/${MODULE_ID}/data/journals`;
const OWNERSHIP_OBSERVER = 2;

/** Creates native Foundry JournalEntries only on a GM-confirmed preset import. */
export class PresetJournalService {
  static async #folder(name, parent = null) {
    const existing = game.folders.find(folder => {
      const currentParent = typeof folder.folder === "string" ? folder.folder :
        (folder.folder?.id ?? folder.parent?.id ?? folder.parent ?? null);
      return folder.type === "JournalEntry" && folder.name === name && currentParent === parent;
    });
    if (existing) return existing;
    return Folder.create({ name, type: "JournalEntry", folder: parent });
  }

  static async import(entry, groupId, { updateExisting = false } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM may create Player Journals.");
    const language = entry.language === "pt-BR" ? "pt-BR" : "en";
    const pt = language === "pt-BR";
    const root = await this.#folder(pt ? "Pontos" : "Points");
    const definitions = [
      { kind: "earning", folder: pt ? "Ganhando" : "Earning", name: pt ? "Ganhando Pontos" : "Earning Points" },
      { kind: "spending", folder: pt ? "Gastando" : "Spending", name: pt ? "Gastando Pontos" : "Spending Points" }
    ];
    const summary = { created: 0, updated: 0, preserved: 0 };
    for (const definition of definitions) {
      const folder = await this.#folder(definition.folder, root.id);
      // Identify by immutable imported-set ID, not by names or locations edited by the GM.
      const existing = game.journal.find(journal => {
        const flag = journal.getFlag?.(MODULE_ID, "presetGuide");
        return flag?.groupId === groupId && flag?.kind === definition.kind;
      });
      if (existing && !updateExisting) { summary.preserved++; continue; }
      const path = entry.journals?.[definition.kind];
      if (!path || !/^[a-z0-9-]+\.html$/i.test(path)) throw new Error("The built-in Player Journal is missing.");
      const response = await fetch(`${BASE}/${path}`);
      if (!response.ok) throw new Error(`Could not read Player Journal (${response.status}).`);
      const content = await response.text();
      if (existing) {
        const page = existing.pages.contents.find(p => p.getFlag?.(MODULE_ID, "presetGuidePage") === definition.kind)
          ?? existing.pages.contents.find(p => p.type === "text");
        if (!page) throw new Error(`The existing ${definition.name} Journal has no editable text page.`);
        await page.update({ "text.content": content, "text.format": 1 });
        summary.updated++;
        continue;
      }
      const suffix = entry.name;
      await JournalEntry.create({
        name: `${definition.name} — ${suffix}`,
        folder: folder.id,
        ownership: { default: OWNERSHIP_OBSERVER },
        flags: { [MODULE_ID]: { presetGuide: { groupId, kind: definition.kind, language, sourcePresetId: entry.id } } },
        pages: [{ name: definition.name, type: "text", text: { format: 1, content }, flags: { [MODULE_ID]: { presetGuidePage: definition.kind } } }]
      });
      summary.created++;
    }
    return summary;
  }
}
