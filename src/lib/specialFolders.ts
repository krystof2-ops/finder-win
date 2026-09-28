import { pathKey } from "./storage";

/**
 * Speciální složky (Plocha, Dokumenty, Stažené, Obrázky, Hudba, Videa, Domů)
 * dostanou na modré složce bílý glyf, jako ve Finderu. Které to jsou, ví
 * backend — posílá je v sekci Oblíbené — a App je sem zapíše po načtení.
 */
const glyphs = new Map<string, string>();

export function setSpecialFolders(items: { path: string; icon_name: string }[]): void {
  glyphs.clear();
  for (const item of items) glyphs.set(pathKey(item.path), item.icon_name);
}

/** Název ikony (klíč do SIDEBAR_ICONS) pro speciální složku, jinak null. */
export function specialFolderGlyph(path: string): string | null {
  return glyphs.get(pathKey(path)) ?? null;
}
