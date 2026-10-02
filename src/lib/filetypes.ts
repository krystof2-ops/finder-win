import type { MessageKey } from "../i18n";

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

/**
 * `kind` je klíč do slovníku (sloupec Druh), `format` parametr {format}
 * v něm — "Obrázek {format}" / "{format} Image" → "Obrázek JPEG" / "JPEG Image".
 */
export type FileType = { kind: MessageKey; format?: string; group: FileGroup; preview: PreviewKind };

const type = (
  kind: MessageKey | [MessageKey, string],
  group: FileGroup,
  preview: PreviewKind = "other",
): FileType =>
  Array.isArray(kind)
    ? { kind: kind[0], format: kind[1], group, preview }
    : { kind, group, preview };

/** Zdrojový kód — druh se skládá z přípony, náhled je vždy text. */
const SOURCE = [
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "sh", "ps1", "bat", "sql", "lua", "dart",
];

const TYPES: Record<string, FileType> = {
  // dokumenty
  pdf: type(["kind.formatDocument", "PDF"], "pdf", "pdf"),
  txt: type("kind.text", "text", "text"),
  log: type("kind.log", "text", "text"),
  md: type(["kind.formatDocument", "Markdown"], "text", "markdown"),
  markdown: type(["kind.formatDocument", "Markdown"], "text", "markdown"),
  rtf: type(["kind.formatDocument", "RTF"], "document"),
  doc: type("kind.word", "document"),
  docx: type("kind.word", "document"),
  xls: type(["kind.spreadsheet", "Excel"], "document"),
  xlsx: type(["kind.spreadsheet", "Excel"], "document"),
  csv: type("kind.csv", "text", "text"),
  ppt: type(["kind.presentation", "PowerPoint"], "document"),
  pptx: type(["kind.presentation", "PowerPoint"], "document"),

  // obrázky — náhled jen formátů, které webview umí vykreslit
  jpg: type(["kind.image", "JPEG"], "image", "image"),
  jpeg: type(["kind.image", "JPEG"], "image", "image"),
  png: type(["kind.image", "PNG"], "image", "image"),
  gif: type(["kind.image", "GIF"], "image", "image"),
  webp: type(["kind.image", "WebP"], "image", "image"),
  svg: type(["kind.image", "SVG"], "image", "image"),
  bmp: type(["kind.image", "BMP"], "image", "image"),
  ico: type("kind.icon", "image", "image"),
  heic: type(["kind.image", "HEIC"], "image"),
  tif: type(["kind.image", "TIFF"], "image"),
  tiff: type(["kind.image", "TIFF"], "image"),

  // video
  mp4: type(["kind.video", "MP4"], "video", "video"),
  m4v: type(["kind.video", "MP4"], "video", "video"),
  webm: type(["kind.video", "WebM"], "video", "video"),
  mov: type(["kind.video", "QuickTime"], "video", "video"),
  mkv: type(["kind.video", "MKV"], "video", "video"),
  avi: type(["kind.video", "AVI"], "video", "video"),
  wmv: type(["kind.video", "WMV"], "video"),

  // zvuk
  mp3: type(["kind.audio", "MP3"], "audio", "audio"),
  wav: type(["kind.audio", "WAV"], "audio", "audio"),
  flac: type(["kind.audio", "FLAC"], "audio", "audio"),
  m4a: type(["kind.audio", "M4A"], "audio", "audio"),
  aac: type(["kind.audio", "AAC"], "audio", "audio"),
  ogg: type(["kind.audio", "OGG"], "audio", "audio"),
  wma: type(["kind.audio", "WMA"], "audio"),

  // archivy a obrazy disků
  zip: type(["kind.archive", "ZIP"], "archive"),
  rar: type(["kind.archive", "RAR"], "archive"),
  "7z": type(["kind.archive", "7z"], "archive"),
  tar: type(["kind.archive", "TAR"], "archive"),
  gz: type(["kind.archive", "GZip"], "archive"),
  iso: type("kind.diskImage", "archive"),

  // aplikace a systém
  exe: type("kind.application", "app"),
  msi: type("kind.installer", "app"),
  dll: type("kind.library", "app"),
  lnk: type("kind.shortcut", "app"),
  url: type("kind.internetShortcut", "app"),

  // data a konfigurace — čitelné jako text
  json: type(["kind.formatDocument", "JSON"], "code", "text"),
  html: type(["kind.formatDocument", "HTML"], "code", "text"),
  css: type("kind.stylesheet", "code", "text"),
  xml: type(["kind.formatDocument", "XML"], "code", "text"),
  toml: type(["kind.config", "TOML"], "code", "text"),
  yml: type(["kind.config", "YAML"], "code", "text"),
  yaml: type(["kind.config", "YAML"], "code", "text"),
  ini: type(["kind.config", "INI"], "code", "text"),

  // písma
  ttf: type(["kind.font", "TrueType"], "document"),
  otf: type(["kind.font", "OpenType"], "document"),
  woff: type("kind.webFont", "document"),
  woff2: type("kind.webFont", "document"),
};

for (const extension of SOURCE) {
  TYPES[extension] ??= type(["kind.sourceCode", extension.toUpperCase()], "code", "text");
}

/** Typ podle přípony (bez tečky, malými písmeny), null pro neznámou. */
export function fileType(extension: string | null): FileType | null {
  return extension ? (TYPES[extension] ?? null) : null;
}
