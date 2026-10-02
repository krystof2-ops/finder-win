import { pathKey } from "./storage";
import type { FavoriteEntry, FavoriteSection } from "../types";

/**
 * Speciální složky (Plocha, Dokumenty, Stažené, Obrázky, Hudba, Videa, Domů)
 * dostanou na modré složce bílý glyf, jako ve Finderu. Které to jsou, ví
 * backend — posílá je v sekci Oblíbené — a App je sem zapíše po načtení.
 */
const glyphs = new Map<string, string>();

/**
 * Složky, které sidebar pojmenovává po svém (Oblíbené a Cloud): záhlaví
 * toolbaru a drobky je ukazují stejným popiskem — "Pictures" místo
 * "Obrázky" z disku. Disky sem nepatří, ty si drží název z cesty.
 */
const named = new Map<string, FavoriteEntry>();

export function setSpecialFolders(sections: FavoriteSection[]): void {
  glyphs.clear();
  named.clear();
  for (const section of sections) {
    if (section.id === "devices") continue;
    for (const item of section.items) {
      if (item.external) continue;
      named.set(pathKey(item.path), item);
      if (section.id === "favorites") glyphs.set(pathKey(item.path), item.icon_name);
    }
  }
}

/** Položka sidebaru se stejnou (normalizovanou) cestou, jinak null. */
export function namedFolder(path: string): FavoriteEntry | null {
  return named.get(pathKey(path)) ?? null;
}

/** Název ikony (klíč do SIDEBAR_ICONS) pro speciální složku, jinak null. */
export function specialFolderGlyph(path: string): string | null {
  return glyphs.get(pathKey(path)) ?? null;
}
