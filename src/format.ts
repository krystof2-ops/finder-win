import { fileType, type PreviewKind } from "./lib/filetypes";
import type { FileEntry } from "./types";

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 0 → "", 1536 → "1,5 KB". Složky nemají velikost, proto prázdný řetězec. */
export function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return "";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} ${SIZE_UNITS[unit]}`;
}

/** Volné místo na disku — vždy v GB s jedním desetinným místem. */
export function formatFreeSpace(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${gb.toLocaleString("cs-CZ", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} GB volných`;
}

/** Unix timestamp v sekundách → "3. 2. 2026 14:05". */
export function formatModified(timestamp: number): string {
  if (!timestamp) return "";

  const date = new Date(timestamp * 1000);
  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Relativní čas pro seznam nedávných. Na rozdíl od formatModified bere
 * **milisekundy**, protože tak si nedávné ukládá storage.
 *
 * Do hodiny minuty, do včerejška hodiny, pak "včera" a nakonec datum —
 * "před 9 dny" už nikomu nic neřekne.
 */
export function formatRelative(timestampMs: number): string {
  if (!timestampMs) return "";

  const seconds = Math.round((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return "teď";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `před ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;

  const date = new Date(timestampMs);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  // "Včera" se počítá podle kalendáře, ne podle 24 hodin zpátky.
  if (date.getTime() >= midnight.getTime() - 86_400_000) return "včera";

  return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

/** Česká shoda čísla s podstatným jménem: 1 položka / 3 položky / 8 položek. */
export function formatItemCount(count: number): string {
  if (count === 1) return "1 položka";
  if (count >= 2 && count <= 4) return `${count} položky`;
  return `${count} položek`;
}

export type Crumb = { label: string; path: string };

/**
 * Kořen a zbytek cesty. Kořen je disk ("C:\") nebo síťový share
 * ("\\server\share") — share se nedá rozseknout, "\\server" sám o sobě
 * složka není a navigace do něj by selhala.
 */
export function splitPath(path: string): { root: string; parts: string[] } {
  const normalized = path.replace(/\//g, "\\");

  if (normalized.startsWith("\\\\")) {
    const segments = normalized.slice(2).split("\\").filter(Boolean);
    return { root: `\\\\${segments.slice(0, 2).join("\\")}`, parts: segments.slice(2) };
  }

  const segments = normalized.split("\\").filter(Boolean);
  // Kořen disku potřebuje koncové zpětné lomítko ("C:" samo o sobě není cesta).
  return { root: segments.length > 0 ? `${segments[0]}\\` : normalized, parts: segments.slice(1) };
}

/** Opak splitPath: kořen + prvních `count` částí. */
export function joinPath(root: string, parts: string[]): string {
  if (parts.length === 0) return root;
  return root.endsWith("\\") ? root + parts.join("\\") : `${root}\\${parts.join("\\")}`;
}

/** "C:\Users\jane\Downloads" → C: › Users › jane › Downloads;
 *  "\\nas\fotky\2024" → \\nas\fotky › 2024 */
export function breadcrumbs(path: string): Crumb[] {
  const { root, parts } = splitPath(path);
  const rootLabel = root.endsWith("\\") ? root.slice(0, -1) : root;

  return [
    { label: rootLabel, path: root },
    ...parts.map((label, index) => ({ label, path: joinPath(root, parts.slice(0, index + 1)) })),
  ];
}

/* ------------------------------ druh souboru ------------------------------ */

/** Sloupec "Druh" v list view. Tabulka přípon je v lib/filetypes.ts. */
export function kindLabel(entry: FileEntry): string {
  if (entry.is_dir) return "Složka";
  if (!entry.extension) return "Dokument";
  return fileType(entry.extension)?.kind ?? `Soubor ${entry.extension.toUpperCase()}`;
}

/* ------------------------------ Quick Look -------------------------------- */

export type { PreviewKind };

/** Jakým způsobem se soubor ukáže v Quick Look náhledu. */
export function previewKind(entry: FileEntry): PreviewKind {
  if (entry.is_dir) return "other";
  return fileType(entry.extension)?.preview ?? "other";
}
/* --------------------------------- řazení --------------------------------- */

/**
 * Přirozené řazení jako v Průzkumníku: "foto2" před "foto10", bez ohledu na
 * velikost písmen, s českou abecedou (č za c). Backend řadí stejně
 * (sort_entries), frontend ale výsledek stejně přeřazuje podle zvoleného sloupce.
 */
const NAME_COLLATOR = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

export function compareNames(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b);
}

export type SortKey = "name" | "modified" | "size" | "kind";
export type SortDirection = "asc" | "desc";

export function sortEntries(
  entries: FileEntry[],
  key: SortKey,
  direction: SortDirection,
): FileEntry[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...entries].sort((a, b) => {
    // Složky drží první bez ohledu na sloupec i směr, stejně jako to vrací backend.
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

    switch (key) {
      case "modified":
        return (a.modified - b.modified) * factor;
      case "size":
        return (a.size - b.size) * factor;
      case "kind":
        return compareNames(kindLabel(a), kindLabel(b)) * factor;
      case "name":
        return compareNames(a.name, b.name) * factor;
    }
  });
}

/* ------------------------------ průhlednost ------------------------------- */

/**
 * Vyjmuté položky čekají na vložení, skryté jsou vidět jen na přání — obojí
 * se kreslí slaběji, jako v Průzkumníku. Vyjmutí má přednost, je čerstvější.
 */
export function entryOpacity(entry: FileEntry, cut: boolean): number {
  if (cut) return 0.5;
  return entry.hidden ? 0.55 : 1;
}
