/**
 * Jediná tabulka typů souborů: přípona → druh (sloupec Druh), skupina ikony
 * a způsob náhledu v Quick Look. Dřív to byly tři seznamy ve dvou souborech
 * a rozcházely se (heic měl ikonu obrázku, ale žádný druh; txt ikonu kódu).
 */

/** Skupina určuje ikonu a její barvu (icons.tsx). */
export type FileGroup =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "code"
  | "text"
  | "document"
  | "archive"
  | "app"
  | "other";

export type PreviewKind = "image" | "pdf" | "markdown" | "text" | "video" | "audio" | "other";

export type FileType = { kind: string; group: FileGroup; preview: PreviewKind };

const type = (kind: string, group: FileGroup, preview: PreviewKind = "other"): FileType => ({
  kind,
  group,
  preview,
});

/** Zdrojový kód — druh se skládá z přípony, náhled je vždy text. */
const SOURCE = [
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "sh", "ps1", "bat", "sql", "lua", "dart",
];

const TYPES: Record<string, FileType> = {
  // dokumenty
  pdf: type("Dokument PDF", "pdf", "pdf"),
  txt: type("Textový dokument", "text", "text"),
  log: type("Protokol", "text", "text"),
  md: type("Dokument Markdown", "text", "markdown"),
  markdown: type("Dokument Markdown", "text", "markdown"),
  rtf: type("Dokument RTF", "document"),
  doc: type("Dokument Word", "document"),
  docx: type("Dokument Word", "document"),
  xls: type("Sešit Excel", "document"),
  xlsx: type("Sešit Excel", "document"),
  csv: type("Tabulka CSV", "text", "text"),
  ppt: type("Prezentace PowerPoint", "document"),
  pptx: type("Prezentace PowerPoint", "document"),

  // obrázky — náhled jen formátů, které webview umí vykreslit
  jpg: type("Obrázek JPEG", "image", "image"),
  jpeg: type("Obrázek JPEG", "image", "image"),
  png: type("Obrázek PNG", "image", "image"),
  gif: type("Obrázek GIF", "image", "image"),
  webp: type("Obrázek WebP", "image", "image"),
  svg: type("Obrázek SVG", "image", "image"),
  bmp: type("Obrázek BMP", "image", "image"),
  ico: type("Ikona", "image", "image"),
  heic: type("Obrázek HEIC", "image"),
  tif: type("Obrázek TIFF", "image"),
  tiff: type("Obrázek TIFF", "image"),

  // video
  mp4: type("Video MP4", "video", "video"),
  m4v: type("Video MP4", "video", "video"),
  webm: type("Video WebM", "video", "video"),
  mov: type("Video QuickTime", "video", "video"),
  mkv: type("Video MKV", "video", "video"),
  avi: type("Video AVI", "video", "video"),
  wmv: type("Video WMV", "video"),

  // zvuk
  mp3: type("Zvuk MP3", "audio", "audio"),
  wav: type("Zvuk WAV", "audio", "audio"),
  flac: type("Zvuk FLAC", "audio", "audio"),
  m4a: type("Zvuk M4A", "audio", "audio"),
  aac: type("Zvuk AAC", "audio", "audio"),
  ogg: type("Zvuk OGG", "audio", "audio"),
  wma: type("Zvuk WMA", "audio"),

  // archivy a obrazy disků
  zip: type("Archiv ZIP", "archive"),
  rar: type("Archiv RAR", "archive"),
  "7z": type("Archiv 7z", "archive"),
  tar: type("Archiv TAR", "archive"),
  gz: type("Archiv GZip", "archive"),
  iso: type("Obraz disku", "archive"),

  // aplikace a systém
  exe: type("Aplikace", "app"),
  msi: type("Instalátor", "app"),
  dll: type("Knihovna DLL", "app"),
  lnk: type("Zástupce", "app"),
  url: type("Internetový zástupce", "app"),

  // data a konfigurace — čitelné jako text
  json: type("Dokument JSON", "code", "text"),
  html: type("Dokument HTML", "code", "text"),
  css: type("Šablona stylů", "code", "text"),
  xml: type("Dokument XML", "code", "text"),
  toml: type("Konfigurace TOML", "code", "text"),
  yml: type("Konfigurace YAML", "code", "text"),
  yaml: type("Konfigurace YAML", "code", "text"),
  ini: type("Konfigurace INI", "code", "text"),

  // písma
  ttf: type("Písmo TrueType", "document"),
  otf: type("Písmo OpenType", "document"),
  woff: type("Webové písmo", "document"),
  woff2: type("Webové písmo", "document"),
};

for (const extension of SOURCE) {
  TYPES[extension] ??= type(`Zdrojový kód ${extension.toUpperCase()}`, "code", "text");
}

/** Typ podle přípony (bez tečky, malými písmeny), null pro neznámou. */
export function fileType(extension: string | null): FileType | null {
  return extension ? (TYPES[extension] ?? null) : null;
}
