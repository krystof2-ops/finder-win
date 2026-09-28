import { canThumbnail, LargeEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { entryOpacity } from "../format";
import { dragItemsFor, endDrag, startDrag } from "../lib/dnd";
import { DROP_TARGET_STYLE, selectMods, useFolderDrop, type DropInto } from "../lib/rowDnd";
import { tagsOf } from "../lib/storage";

import type { FileEntry, SelectMods, TagMap } from "../types";

/** Strop náhledů obrázků v jedné složce. */
const MAX_THUMBNAILS = 200;

type IconViewProps = {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  cutPaths: Set<string>;
  windowFocused: boolean;
  renamingPath: string | null;
  onRenameSubmit: (entry: FileEntry, name: string) => void;
  onRenameCancel: () => void;
  onSelect: (entry: FileEntry, mods: SelectMods) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  onDropInto: DropInto;
  tags: TagMap;
};

export function IconView({
  entries,
  selectedPaths,
  cutPaths,
  windowFocused,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  onSelect,
  onOpen,
  onContextMenu,
  onDropInto,
  tags,
}: IconViewProps) {
  const { dropTarget, dropProps } = useFolderDrop(onDropInto);
  const selectedEntries = entries.filter((entry) => selectedPaths.has(entry.path));
  // Náhledy jen prvních 200 obrázků ve složce — dál by dekódování tisíců
  // fotek zabralo paměť i čas; zbytek má ikonu.
  const thumbnailPaths = new Set(
    entries
      .filter(canThumbnail)
      .slice(0, MAX_THUMBNAILS)
      .map((entry) => entry.path),
  );

  return (
    <div className="fw-icon-grid">
      {entries.map((entry) => {
        const isSelected = selectedPaths.has(entry.path);
        const isRenaming = entry.path === renamingPath;
        // Během přejmenování výběr nekreslíme — podbarvení pod inputem ruší.
        const showSelection = isSelected && !isRenaming;
        // Finder: za ikonou neutrální zaoblený obdélník, název na pilulce —
        // modré s bílým textem jen v aktivním okně, jinak šedé.
        const tileBg = showSelection ? "var(--icon-selection)" : "transparent";
        const nameBg = showSelection
          ? windowFocused
            ? "var(--accent)"
            : "var(--name-pill-inactive)"
          : "transparent";
        const nameColor = showSelection && windowFocused ? "var(--on-accent)" : "var(--text-primary)";

        return (
          <div
            key={entry.path}
            data-path={entry.path}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            data-tooltip={entry.name}
            // Přejmenovaný řádek se netahá — jinak by drag ukradl výběr v inputu.
            draggable={!isRenaming}
            onDragStart={(event) =>
              startDrag(
                { kind: "entry", items: dragItemsFor(entry, selectedEntries) },
                event.dataTransfer,
              )
            }
            onDragEnd={endDrag}
            {...dropProps(entry)}
            onClick={(event) => onSelect(entry, selectMods(event))}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              // Nebublat na kontejner — ten má menu volné plochy. Výběr řeší
              // App: pravý klik do už vybrané skupiny ji nesmí shodit na jednu.
              event.stopPropagation();
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className="fw-row flex w-[96px] flex-col items-center gap-1 rounded-[8px]"
            style={{
              opacity: entryOpacity(entry, cutPaths.has(entry.path)),
              ...(dropTarget === entry.path ? DROP_TARGET_STYLE : null),
            }}
          >
            {/* Ikona stojí volně v 64px boxu; výběr je obdélník za ní. */}
            <div className="fw-icon-tile p-1" style={{ backgroundColor: tileBg }}>
              <LargeEntryIcon entry={entry} thumbnail={thumbnailPaths.has(entry.path)} />
            </div>

            {isRenaming ? (
              <div className="w-full px-0.5">
                <RenameInput
                  entry={entry}
                  onSubmit={onRenameSubmit}
                  onCancel={onRenameCancel}
                  centered
                />
              </div>
            ) : (
              <span
                className="fw-icon-name line-clamp-2 max-w-full text-center"
                style={{
                  backgroundColor: nameBg,
                  color: nameColor,
                  overflowWrap: "anywhere",
                }}
              >
                {entry.name}
              </span>
            )}

            {!isRenaming && <TagDots colors={tagsOf(tags, entry.path)} size={8} />}
          </div>
        );
      })}
    </div>
  );
}
