import {
  ArrowUpRight,
  Cloud,
  Disc,
  Download,
  File,
  FileAudio,
  FileCode2,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
  Home,
  Image as ImageIcon,
  Monitor,
  Music,
  Network,
  Smartphone,
  Usb,
  Video,
  type LucideIcon,
} from "lucide-react";

import type { FileEntry } from "../types";

/**
 * Gradienty pro složkovou ikonu se renderují jednou pro celou aplikaci,
 * jinak by každá z desítek položek v gridu tahala vlastní <defs>.
 */
export function IconDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <linearGradient id="fw-folder-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5fa3dd" />
          <stop offset="100%" stopColor="#3f88cc" />
        </linearGradient>
        <linearGradient id="fw-folder-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6faee5" />
          <stop offset="100%" stopColor="#4a94d6" />
        </linearGradient>
        <linearGradient id="fw-folder-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Složka ve stylu macOS: zadní deska s ouškem + přední deska s lehce vyklenutou hranou. */
export function FolderIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0">
      {/* zadní deska s ouškem */}
      <path
        d="M4 17.5A5.5 5.5 0 0 1 9.5 12h13.2a5.5 5.5 0 0 1 3.9 1.6l3.1 3.1a5.5 5.5 0 0 0 3.9 1.6H54.5A5.5 5.5 0 0 1 60 23.8V46.5A5.5 5.5 0 0 1 54.5 52h-45A5.5 5.5 0 0 1 4 46.5z"
        fill="url(#fw-folder-back)"
      />
      {/* přední deska — horní hrana je mírně vyklenutá, to dělá ten 3D dojem */}
      <path
        d="M4 27Q32 24.2 60 27V46.5A5.5 5.5 0 0 1 54.5 52h-45A5.5 5.5 0 0 1 4 46.5z"
        fill="url(#fw-folder-front)"
      />
      {/* světelný odlesk na horní třetině přední desky */}
      <path
        d="M4 27Q32 24.2 60 27v6.5Q32 30.7 4 33.5z"
        fill="url(#fw-folder-shine)"
      />
    </svg>
  );
}

/* ----------------------------- ikony souborů ------------------------------ */

type FileVisual = { Icon: LucideIcon; tint: string };

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "heic", "tiff",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "webm", "wmv", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"]);
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "sh", "ps1", "sql", "lua", "dart",
  "json", "html", "css", "toml", "yml", "yaml", "xml", "txt", "md",
]);

export function fileVisual(entry: FileEntry): FileVisual {
  const extension = entry.extension ?? "";

  if (IMAGE_EXTENSIONS.has(extension)) return { Icon: ImageIcon, tint: "#ff9500" };
  if (extension === "pdf") return { Icon: FileText, tint: "#ff3b30" };
  if (VIDEO_EXTENSIONS.has(extension)) return { Icon: FileVideo, tint: "#af52de" };
  if (AUDIO_EXTENSIONS.has(extension)) return { Icon: FileAudio, tint: "#30d158" };
  if (CODE_EXTENSIONS.has(extension)) return { Icon: FileCode2, tint: "#0a84ff" };

  return { Icon: File, tint: "var(--text-secondary)" };
}

/**
 * Odkaz (symlink / junction) dostane v levém dolním rohu šipku jako alias
 * ve Finderu — jinak by nešlo poznat, že složka ve skutečnosti leží jinde.
 */
function WithLinkBadge({
  entry,
  size,
  children,
}: {
  entry: FileEntry;
  size: number;
  children: React.ReactNode;
}) {
  if (!entry.is_symlink) return <>{children}</>;

  const badge = Math.max(8, Math.round(size * 0.4));

  return (
    <span className="relative inline-flex shrink-0" aria-label="Odkaz">
      {children}
      <span
        className="absolute bottom-0 left-0 flex items-center justify-center rounded-sm"
        style={{
          width: badge,
          height: badge,
          background: "var(--bg-main)",
          boxShadow: "0 0 0 0.5px var(--paper-border)",
        }}
      >
        <ArrowUpRight size={badge - 1} strokeWidth={2.5} color="var(--text-primary)" />
      </span>
    </span>
  );
}

/** Velká ikona pro icon view — soubory dostanou bílý "papírek". */
export function LargeEntryIcon({ entry }: { entry: FileEntry }) {
  return (
    <WithLinkBadge entry={entry} size={64}>
      <LargeIcon entry={entry} />
    </WithLinkBadge>
  );
}

function LargeIcon({ entry }: { entry: FileEntry }) {
  if (entry.is_dir) return <FolderIcon size={64} />;

  const { Icon, tint } = fileVisual(entry);

  return (
    <div className="flex h-16 w-16 items-center justify-center">
      <div
        className="flex h-[60px] w-[46px] items-center justify-center rounded-lg"
        style={{
          background: "var(--paper)",
          border: "1px solid var(--paper-border)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
        }}
      >
        <Icon size={24} color={tint} strokeWidth={1.75} />
      </div>
    </div>
  );
}

/** Malá ikona 16px pro list view. */
export function SmallEntryIcon({ entry }: { entry: FileEntry }) {
  return (
    <WithLinkBadge entry={entry} size={16}>
      <SmallIcon entry={entry} />
    </WithLinkBadge>
  );
}

function SmallIcon({ entry }: { entry: FileEntry }) {
  if (entry.is_dir) return <FolderIcon size={16} />;

  const { Icon, tint } = fileVisual(entry);
  return <Icon size={16} color={tint} strokeWidth={1.75} className="shrink-0" />;
}

/* ----------------------------- ikony sidebaru ----------------------------- */

const SIDEBAR_ICONS: Record<string, LucideIcon> = {
  Monitor,
  Download,
  FileText,
  Image: ImageIcon,
  Music,
  Video,
  Cloud,
  Folder,
  HardDrive,
  Usb,
  Disc,
  Network,
  Smartphone,
  Home,
};

export function sidebarIcon(iconName: string): LucideIcon {
  return SIDEBAR_ICONS[iconName] ?? Folder;
}

/**
 * Finder tintuje ikony v sidebaru podle skupiny, ne jednotně šedě.
 * Barva se odvozuje od sekce, jen iCloud Photos má vlastní odstín.
 */
export function sidebarIconColor(sectionLabel: string, itemLabel: string): string {
  switch (sectionLabel) {
    case "Oblíbené":
      return "var(--accent)";
    case "iCloud":
      return itemLabel === "iCloud Photos" ? "#af52de" : "#5eb5f0";
    default:
      return "var(--text-secondary)";
  }
}
