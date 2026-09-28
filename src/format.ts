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

/** "C:\Users\jane\Downloads" → C: › Users › jane › Downloads */
export function breadcrumbs(path: string): Crumb[] {
  const parts = path.split("\\").filter(Boolean);

  return parts.map((label, index) => ({
    label,
    // Kořen disku potřebuje koncové zpětné lomítko ("C:" samo o sobě není cesta.)
    path: index === 0 ? `${parts[0]}\\` : parts.slice(0, index + 1).join("\\"),
  }));
}

/* ------------------------------ druh souboru ------------------------------ */

const KINDS: Record<string, string> = {
  pdf: "Dokument PDF",
  txt: "Textový dokument",
  md: "Dokument Markdown",
  rtf: "Dokument RTF",
  doc: "Dokument Word",
  docx: "Dokument Word",
  xls: "Sešit Excel",
  xlsx: "Sešit Excel",
  ppt: "Prezentace PowerPoint",
  pptx: "Prezentace PowerPoint",
  jpg: "Obrázek JPEG",
  jpeg: "Obrázek JPEG",
  png: "Obrázek PNG",
  gif: "Obrázek GIF",
  webp: "Obrázek WebP",
  svg: "Obrázek SVG",
  bmp: "Obrázek BMP",
  heic: "Obrázek HEIC",
  ico: "Ikona",
  mp4: "Video MP4",
  mov: "Video QuickTime",
  mkv: "Video MKV",
  avi: "Video AVI",
  webm: "Video WebM",
  wmv: "Video WMV",
  mp3: "Zvuk MP3",
  wav: "Zvuk WAV",
  flac: "Zvuk FLAC",
  m4a: "Zvuk M4A",
  aac: "Zvuk AAC",
  ogg: "Zvuk OGG",
  zip: "Archiv ZIP",
  rar: "Archiv RAR",
  "7z": "Archiv 7z",
  tar: "Archiv TAR",
  gz: "Archiv GZip",
  iso: "Obraz disku",
  exe: "Aplikace",
  msi: "Instalátor",
  dll: "Knihovna DLL",
  json: "Dokument JSON",
  html: "Dokument HTML",
  css: "Šablona stylů",
  toml: "Konfigurace TOML",
  yml: "Konfigurace YAML",
  yaml: "Konfigurace YAML",
  ttf: "Písmo TrueType",
  otf: "Písmo OpenType",
  lnk: "Zástupce",
  url: "Internetový zástupce",
};

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "sh", "ps1", "sql", "lua", "dart",
]);

/** Sloupec "Kind" v list view. */
export function kindLabel(entry: FileEntry): string {
  if (entry.is_dir) return "Složka";
  if (!entry.extension) return "Dokument";

  const known = KINDS[entry.extension];
  if (known) return known;
  if (SOURCE_EXTENSIONS.has(entry.extension)) {
    return `Zdrojový kód ${entry.extension.toUpperCase()}`;
  }

  return `Soubor ${entry.extension.toUpperCase()}`;
}

/* ------------------------------ Quick Look -------------------------------- */

export type PreviewKind = "image" | "pdf" | "markdown" | "text" | "video" | "audio" | "other";

const PREVIEW_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);
const PREVIEW_MARKDOWN = new Set(["md", "markdown"]);
const PREVIEW_VIDEO = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const PREVIEW_AUDIO = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac"]);
const PREVIEW_TEXT = new Set([
  "txt", "json", "js", "ts", "tsx", "jsx", "py", "rs", "html", "css", "yaml",
  "yml", "toml", "xml", "log", "csv", "ini", "bat", "ps1", "sh", "go", "java",
  "cs", "c", "cpp", "h", "hpp",
]);

/** Jakým způsobem se soubor ukáže v Quick Look náhledu. */
export function previewKind(entry: FileEntry): PreviewKind {
  if (entry.is_dir) return "other";

  const extension = entry.extension ?? "";

  // Markdown má přednost před obecným textem.
  if (PREVIEW_MARKDOWN.has(extension)) return "markdown";
  if (PREVIEW_IMAGE.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (PREVIEW_VIDEO.has(extension)) return "video";
  if (PREVIEW_AUDIO.has(extension)) return "audio";
  if (PREVIEW_TEXT.has(extension)) return "text";

  return "other";
}

/* --------------------------------- řazení --------------------------------- */

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
        return kindLabel(a).localeCompare(kindLabel(b), "cs") * factor;
      case "name":
        return a.name.localeCompare(b.name, "cs", { sensitivity: "base" }) * factor;
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
