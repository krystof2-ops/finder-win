import type { FileEntry } from "../types";

/**
 * Stejná položka pro účely vykreslení? Výpis po každém refreshi vrací nové
 * objekty, takže identita nestačí — porovnávají se pole, která řádek ukazuje.
 */
export function sameEntry(a: FileEntry, b: FileEntry): boolean {
  return (
    a === b ||
    (a.path === b.path &&
      a.name === b.name &&
      a.size === b.size &&
      a.modified === b.modified &&
      a.created === b.created &&
      a.is_dir === b.is_dir &&
      a.hidden === b.hidden &&
      a.is_symlink === b.is_symlink)
  );
}
