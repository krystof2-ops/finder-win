import { useCallback, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AppWindow,
  ArrowUpRight,
  Cloud,
  Disc,
  Download,
  File,
  FileArchive,
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

import { iconRequestSize, useFileIcon, useVisible } from "../lib/fileIcons";
import { fileType, type FileGroup } from "../lib/filetypes";
import { specialFolderGlyph } from "../lib/specialFolders";
import type { FileEntry } from "../types";

/**
 * Složka ve stylu macOS Sonoma: světlejší zadní deska se záložkou, sytější
 * přední deska, zaoblení 3 px. V 64px boxu je 64×52. Speciální složky
 * (Plocha, Dokumenty…) mají uprostřed bílý glyf jako ve Finderu.
 */
export function FolderIcon({ size = 64, glyph }: { size?: number; glyph?: string | null }) {
  // Glyf má smysl jen tam, kde je vidět — v 16px řádku by byl šum.
  const Glyph = glyph && size >= 32 ? sidebarIcon(glyph) : null;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0" aria-hidden>
      <path
        d="M5 6h17.6a3 3 0 0 1 2.3 1.1l3.3 3.9H59a3 3 0 0 1 3 3V55a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z"
        fill="var(--folder-back)"
      />
      <path
        d="M5 17h54a3 3 0 0 1 3 3v35a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V20a3 3 0 0 1 3-3z"
        fill="var(--folder-front)"
      />
      {Glyph && (
        <Glyph x={21} y={26.5} width={22} height={22} strokeWidth={2} color="var(--folder-glyph)" />
      )}
    </svg>
  );
}

/* ----------------------------- ikony souborů ------------------------------ */

type FileVisual = { Icon: LucideIcon; tint: string };

/** Obecná ikona podle skupiny z lib/filetypes.ts — ukazuje se, dokud nedorazí
 *  ikona ze shellu, a zůstane, když ji shell nedá. Barvy jsou tokeny. */
const GROUP_VISUALS: Record<FileGroup, FileVisual> = {
  image: { Icon: ImageIcon, tint: "var(--tint-image)" },
  pdf: { Icon: FileText, tint: "var(--tint-pdf)" },
  video: { Icon: FileVideo, tint: "var(--tint-video)" },
  audio: { Icon: FileAudio, tint: "var(--tint-audio)" },
  code: { Icon: FileCode2, tint: "var(--tint-code)" },
  text: { Icon: FileText, tint: "var(--text-secondary)" },
  document: { Icon: FileText, tint: "var(--tint-document)" },
  archive: { Icon: FileArchive, tint: "var(--tint-archive)" },
  app: { Icon: AppWindow, tint: "var(--text-secondary)" },
  other: { Icon: File, tint: "var(--text-secondary)" },
};

export function fileVisual(entry: FileEntry): FileVisual {
  return GROUP_VISUALS[fileType(entry.extension)?.group ?? "other"];
}

/**
 * Odkaz (symlink / junction) dostane vpravo dole malou šipku jako ve
 * Windows — jinak by nešlo poznat, že složka ve skutečnosti leží jinde.
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

  const badge = Math.max(7, Math.round(size * 0.32));

  return (
    <span className="relative inline-flex shrink-0" aria-label="Odkaz">
      {children}
      <span
        className="absolute right-0 bottom-0 flex items-center justify-center rounded-[2px]"
        style={{
          width: badge,
          height: badge,
          background: "var(--badge-bg)",
          boxShadow: "0 0 0 0.5px var(--thumb-border)",
        }}
      >
        <ArrowUpRight size={badge - 1} strokeWidth={2.75} color="var(--badge-fg)" />
      </span>
    </span>
  );
}

/**
 * Ikona souboru ze shellu (jako v Průzkumníku) v boxu `size`×`size`. Dokud
 * nedorazí, stojí na jejím místě obecná ikona podle přípony — box má pořád
 * stejnou velikost, takže nic neposkočí.
 */
function ShellIcon({ entry, size }: { entry: FileEntry; size: number }) {
  const { ref, url } = useFileIcon(entry, iconRequestSize(size));
  const { Icon, tint } = fileVisual(entry);
  // Ikona z paměti je tu hned při vykreslení a nerozsvěcuje se — jinak by
  // při scrollování virtualizovaného výpisu blikal každý nový řádek.
  const arrivedLater = useRef(url === null);

  return (
    <span
      ref={ref}
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          src={url}
          width={size}
          height={size}
          alt=""
          draggable={false}
          className={arrivedLater.current ? "fw-icon-in" : undefined}
        />
      ) : (
        <Icon size={Math.round(size * 0.75)} color={tint} strokeWidth={size > 32 ? 1.25 : 1.75} />
      )}
    </span>
  );
}

/** Přípony, které webview umí vykreslit jako obrázek (heic jen s rozšířením
 *  HEIF — když ne, onError spadne na ikonu). */
const THUMBNAIL_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic"]);

export function canThumbnail(entry: FileEntry): boolean {
  return !entry.is_dir && THUMBNAIL_EXTENSIONS.has(entry.extension ?? "");
}

/** Náhled obrázku — líně, až když je vidět, jinak by složka s tisíci fotek
 *  dekódovala všechny naráz. Když se nenačte, zůstane ikona. */
function Thumbnail({ entry, size }: { entry: FileEntry; size: number }) {
  const [ref, visible] = useVisible();
  const [failed, setFailed] = useState(false);
  // Náhled se ukáže, až je dekódovaný — do té doby průhledný, žádný poloviční
  // obrázek. Z mezipaměti (complete hned po připojení) bez rozsvěcení.
  const [shown, setShown] = useState<"no" | "fade" | "instant">("no");
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setShown("instant");
  }, []);

  if (failed) return <ShellIcon entry={entry} size={size} />;

  return (
    <span
      ref={ref}
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {visible ? (
        <img
          ref={imageRef}
          src={convertFileSrc(entry.path)}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setShown((current) => (current === "no" ? "fade" : current))}
          onError={() => setFailed(true)}
          className={`h-full w-full rounded-[4px] object-cover ${shown === "fade" ? "fw-icon-in" : ""}`}
          style={{ border: "1px solid var(--thumb-border)", opacity: shown === "no" ? 0 : undefined }}
        />
      ) : (
        <ShellIcon entry={entry} size={size} />
      )}
    </span>
  );
}

/**
 * Ikona položky v libovolné velikosti: složka (se speciálním glyfem), náhled
 * obrázku (když `thumbnail`), jinak ikona ze shellu. Odkaz dostane šipku.
 */
export function EntryIcon({
  entry,
  size,
  thumbnail = false,
}: {
  entry: FileEntry;
  size: number;
  thumbnail?: boolean;
}) {
  return (
    <WithLinkBadge entry={entry} size={size}>
      {entry.is_dir ? (
        <FolderIcon size={size} glyph={specialFolderGlyph(entry.path)} />
      ) : thumbnail && canThumbnail(entry) ? (
        <Thumbnail entry={entry} size={size} />
      ) : (
        <ShellIcon entry={entry} size={size} />
      )}
    </WithLinkBadge>
  );
}

/** Velká ikona 64px pro icon view. `thumbnail` = u obrázku ukázat náhled. */
export function LargeEntryIcon({ entry, thumbnail = false }: { entry: FileEntry; thumbnail?: boolean }) {
  return <EntryIcon entry={entry} size={64} thumbnail={thumbnail} />;
}

/** Malá ikona 16px pro list view, sloupce a výsledky. */
export function SmallEntryIcon({ entry }: { entry: FileEntry }) {
  return (
    <WithLinkBadge entry={entry} size={16}>
      {entry.is_dir ? <FolderIcon size={16} /> : <ShellIcon entry={entry} size={16} />}
    </WithLinkBadge>
  );
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

/** Backend posílá anglické klíče standardních složek, UI je česky. */
const SIDEBAR_LABELS: Record<string, string> = {
  Desktop: "Plocha",
  Downloads: "Stažené",
  Documents: "Dokumenty",
  Pictures: "Obrázky",
  Music: "Hudba",
  Videos: "Videa",
  Home: "Domů",
};

export function sidebarLabel(label: string): string {
  return SIDEBAR_LABELS[label] ?? label;
}

export function sidebarIcon(iconName: string): LucideIcon {
  return SIDEBAR_ICONS[iconName] ?? Folder;
}

/**
 * Finder Sonoma: ikony Oblíbených jsou modré (akcent), ostatní sekce tlumené.
 * `itemLabel` zůstává v podpisu pro případné výjimky jednotlivých položek.
 */
export function sidebarIconColor(sectionLabel: string, _itemLabel: string): string {
  return sectionLabel === "Oblíbené" ? "var(--accent)" : "var(--text-secondary)";
}
