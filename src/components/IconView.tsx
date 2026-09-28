import { canThumbnail, LargeEntryIcon } from "./icons";
import { RenameInput } from "./RenameInput";
import { TagDots } from "./TagDots";
import { entryOpacity } from "../format";
import { dragItemsFor, endDrag, startDrag } from "../lib/dnd";
import { DROP_TARGET_STYLE, selectMods, useFolderDrop, type DropInto } from "../lib/rowDnd";
import { tagsOf } from "../lib/storage";

/**
 * Restartuje "pop" animaci. Pouhé přidání třídy nestačí — když už na prvku
 * visí, prohlížeč animaci nepřehraje znovu, dokud si nevynutíme reflow.
 */
function playPop(host: HTMLElement): void {
  const inner = host.querySelector<HTMLElement>(".fw-card-inner");
  if (inner === null) return;

  inner.classList.remove("fw-pop");
  void inner.offsetWidth;
  inner.classList.add("fw-pop");
}
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
    <div
      className="grid gap-5 p-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}
    >
      {entries.map((entry) => {
        const isSelected = selectedPaths.has(entry.path);
        const isRenaming = entry.path === renamingPath;
        // Během přejmenování výběr nekreslíme — podbarvení pod inputem ruší.
        const showSelection = isSelected && !isRenaming;
        // Jedno místo pro odstín výběru: ikona i jméno musí vyjít stejně.
        const selectionBg = showSelection
          ? windowFocused
            ? "var(--icon-selection)"
            : "var(--row-selected-inactive)"
          : "transparent";

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
            onClick={(event) => {
              playPop(event.currentTarget);
              onSelect(entry, selectMods(event));
            }}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              // Nebublat na kontejner — ten má menu volné plochy. Výběr řeší
              // App: pravý klik do už vybrané skupiny ji nesmí shodit na jednu.
              event.stopPropagation();
              onContextMenu?.(entry, event.clientX, event.clientY);
            }}
            className="fw-card fw-row flex h-[118px] w-full flex-col items-center gap-1"
            style={{
              opacity: entryOpacity(entry, cutPaths.has(entry.path)),
              ...(dropTarget === entry.path ? DROP_TARGET_STYLE : null),
            }}
          >
            {/* Dlaždice pod ikonou. Stejný odstín jako pilulka se jménem níž —
                obojí bere selectionBg, takže se to nemůže rozejít. */}
            <div
              className="fw-card-inner rounded-[10px] p-1"
              style={{ backgroundColor: selectionBg }}
            >
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
                className="line-clamp-2 rounded-[5px] px-1.5 text-center text-[12px] text-primary leading-tight transition-colors duration-100"
                style={{
                  backgroundColor: selectionBg,
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
